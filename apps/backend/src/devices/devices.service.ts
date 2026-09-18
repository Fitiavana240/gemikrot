import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Device, DeviceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { DeviceDetectionService } from './device-detection.service.js';
import type { EnableBypassDto, RegisterDeviceDto } from './dto/register-device.dto.js';

export interface DiscoveredDevice {
  macAddress: string;
  ipAddress: string | null;
  hostname: string | null;
  /** Vrai si l'appareil est déjà suivi en base. */
  known: boolean;
  bypassEnabled: boolean;
  suggestedType: DeviceType;
  detectionSource: string;
  confidence: 'high' | 'medium' | 'low';
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clients: MikrotikClientFactory,
    private readonly detection: DeviceDetectionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  findAll(filter: { customerId?: string; subscriptionId?: string } = {}): Promise<Device[]> {
    return this.prisma.scoped.device.findMany({ where: filter, orderBy: { lastSeenAt: 'desc' } });
  }

  async findOne(id: string): Promise<Device> {
    const device = await this.prisma.scoped.device.findUnique({ where: { id } });
    if (!device) throw new NotFoundException(`Appareil ${id} introuvable`);
    return device;
  }

  /**
   * Croise les baux DHCP du routeur avec les appareils déjà suivis, et
   * propose un type pour chacun. L'admin confirme avant toute écriture sur
   * le routeur (décision utilisateur : jamais de contournement automatique).
   */
  async discover(routerId?: string): Promise<DiscoveredDevice[]> {
    const resolvedRouterId = routerId ?? (await this.clients.getDefaultRouterId());
    const mikrotik = await this.clients.forRouter(resolvedRouterId);

    const [leases, bindings, known] = await Promise.all([
      mikrotik.getDhcpLeases(),
      mikrotik.getIpBindings(),
      this.prisma.scoped.device.findMany({ where: { routerId: resolvedRouterId } }),
    ]);

    const knownByMac = new Map(known.map((device) => [device.macAddress.toUpperCase(), device]));
    const bypassedMacs = new Set(
      bindings.filter((b) => b.type === 'bypassed').map((b) => b.macAddress.toUpperCase()),
    );

    return leases.map((lease) => {
      const mac = lease.macAddress.toUpperCase();
      const detected = this.detection.detect({
        macAddress: lease.macAddress,
        hostname: lease.hostName,
      });
      return {
        macAddress: lease.macAddress,
        ipAddress: lease.address || null,
        hostname: lease.hostName,
        known: knownByMac.has(mac),
        bypassEnabled: bypassedMacs.has(mac),
        suggestedType: knownByMac.get(mac)?.type ?? detected.type,
        detectionSource: detected.source,
        confidence: detected.confidence,
      };
    });
  }

  /** Enregistre un appareil avec le type confirmé par l'admin. */
  async register(dto: RegisterDeviceDto, adminUserId?: string): Promise<Device> {
    const routerId = dto.routerId ?? (await this.clients.getDefaultRouterId());
    const detected = this.detection.detect({ macAddress: dto.macAddress, hostname: dto.hostname });

    const device = await this.prisma.scoped.device.create({
      data: {
        tenantId: this.tenantContext.requireTenantId(),
        customerId: dto.customerId,
        subscriptionId: dto.subscriptionId,
        routerId,
        macAddress: dto.macAddress,
        ipAddress: dto.ipAddress,
        hostname: dto.hostname,
        type: dto.type,
        detectedType: detected.type,
        detectionSource: detected.source,
      },
    });

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'REGISTER_DEVICE',
      targetType: 'Device',
      targetId: device.id,
      payloadDiff: { macAddress: dto.macAddress, type: dto.type, detectedType: detected.type },
    });
    return device;
  }

  /**
   * Active le contournement du portail captif pour un appareil qui ne sait
   * pas l'afficher (TV, caméra — Section 20). Crée l'ip-binding `bypassed`
   * sur le routeur et mémorise son identifiant pour pouvoir le basculer en
   * `blocked` à la suspension.
   */
  async enableBypass(deviceId: string, dto: EnableBypassDto, adminUserId?: string): Promise<Device> {
    const device = await this.findOne(deviceId);
    if (device.bypassEnabled && device.mikrotikBindingId) {
      throw new ConflictException(`Le contournement est déjà actif pour ${device.macAddress}`);
    }

    const routerId = device.routerId ?? (await this.clients.getDefaultRouterId());
    const mikrotik = await this.clients.forRouter(routerId);

    // Un binding peut déjà exister côté routeur (créé à la main avant
    // l'application) : on le réutilise au lieu d'échouer sur un doublon.
    const existing = (await mikrotik.getIpBindings()).find(
      (binding) => binding.macAddress.toUpperCase() === device.macAddress.toUpperCase(),
    );
    const binding =
      existing ??
      (await mikrotik.createIpBinding({
        macAddress: device.macAddress,
        type: 'bypassed',
        server: dto.server,
        comment: dto.comment ?? `wifitati:device:${device.id}`,
      }));

    if (existing && existing.type !== 'bypassed') {
      await mikrotik.setIpBindingType(existing.id, 'bypassed');
    }

    const updated = await this.prisma.scoped.device.update({
      where: { id: deviceId },
      data: { bypassEnabled: true, mikrotikBindingId: binding.id, routerId },
    });

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'ENABLE_DEVICE_BYPASS',
      targetType: 'Device',
      targetId: deviceId,
      payloadDiff: { macAddress: device.macAddress, bindingId: binding.id, reused: !!existing },
    });
    return updated;
  }

  /** Bloque l'appareil sur le routeur (suspension) sans perdre l'entrée. */
  async blockBypass(deviceId: string, adminUserId?: string): Promise<Device> {
    const device = await this.findOne(deviceId);
    if (!device.mikrotikBindingId) {
      throw new ConflictException(`Aucun contournement enregistré pour ${device.macAddress}`);
    }

    const routerId = device.routerId ?? (await this.clients.getDefaultRouterId());
    const mikrotik = await this.clients.forRouter(routerId);
    await mikrotik.setIpBindingType(device.mikrotikBindingId, 'blocked');

    const updated = await this.prisma.scoped.device.update({
      where: { id: deviceId },
      data: { bypassEnabled: false },
    });
    await this.audit.log({
      adminUserId,
      routerId,
      action: 'BLOCK_DEVICE',
      targetType: 'Device',
      targetId: deviceId,
      payloadDiff: { macAddress: device.macAddress },
    });
    return updated;
  }
}
