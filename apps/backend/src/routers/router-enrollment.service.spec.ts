import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { RouterCredentialsService } from './router-credentials.service.js';
import { RouterEnrollmentService } from './router-enrollment.service.js';
import { WireguardService } from './wireguard.service.js';

/** Clé de test : les identifiants d'API sont chiffrés comme en production. */
const SETTINGS: Record<string, string> = {
  ROUTER_CREDENTIALS_KEY: 'a'.repeat(64),
  WIREGUARD_ENDPOINT_HOST: 'vps.gemikrot.mg',
  WIREGUARD_SERVER_PUBLIC_KEY: 'k'.repeat(43) + '=',
  WIREGUARD_SUBNET: '10.88.0.0/24',
  WIREGUARD_SERVER_ADDRESS: '10.88.0.1',
  PUBLIC_BASE_URL: 'https://vps.gemikrot.mg',
};

const config = {
  get: (key: string) => SETTINGS[key],
  getOrThrow: (key: string) => SETTINGS[key],
} as never;

/** Une clé publique WireGuard a la forme d'un base64 de 32 octets. */
const routerKey = (seed: string) => seed.repeat(43).slice(0, 43) + '=';

describe('RouterEnrollmentService', () => {
  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(tenantContext);
  const wireguard = new WireguardService(config);
  const service = new RouterEnrollmentService(
    prisma,
    new RouterCredentialsService(config),
    wireguard,
    tenantContext,
    config,
  );

  const suffix = Date.now();
  const tenantA = `enr-a-${suffix}`;
  const tenantB = `enr-b-${suffix}`;

  beforeAll(async () => {
    await prisma.$connect();
    for (const [id, name] of [
      [tenantA, 'Enrôlement A'],
      [tenantB, 'Enrôlement B'],
    ]) {
      await prisma.tenant.create({
        data: { id, slug: id, name, wifiName: name, currency: 'MGA', status: 'ACTIVE' },
      });
    }
  });

  afterAll(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      await prisma.routerEnrollment.deleteMany({ where: { tenantId } });
      await prisma.router.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  const asA = <T>(fn: () => Promise<T>) => tenantContext.runAsTenant(tenantA, fn);

  describe('invitation', () => {
    it("produit un script exécutable et n'écrit rien sur le routeur", async () => {
      const invitation = await asA(() => service.invite('Routeur Sanfily'));

      // Le tunnel : la clé privée doit rester sur le routeur, donc le script
      // la crée là-bas et ne la transmet jamais.
      expect(invitation.script).toContain('/interface/wireguard/add name=gemikrot');
      expect(invitation.script).not.toContain('private-key');

      // Le compte applicatif : jamais `admin`, et des droits nommés.
      expect(invitation.script).toContain('/user/add name=gemikrot-api');
      expect(invitation.script).not.toMatch(/name=admin\b/);

      // L'autorisation du serveur s'ajoute aux existantes : remplacer la
      // liste couperait l'accès actuel si le tunnel ne montait pas, et il
      // faudrait revenir par Winbox pour le rétablir.
      expect(invitation.script).toContain(':local acl [/ip/service/get www-ssl address]');
      expect(invitation.script).toContain(
        '/ip/service/set www-ssl address=($acl,10.88.0.1/32)',
      );

      // Le rappel, avec le jeton — qui n'existe qu'ici. Il part par Internet
      // et non par le tunnel : le serveur ne connaîtra la clé publique de ce
      // routeur qu'en le recevant, donc le tunnel ne peut pas encore être
      // monté à cet instant.
      expect(invitation.script).toContain(
        'https://vps.gemikrot.mg/router-enrollments/callback/',
      );

      // Une adresse en /32 ne crée aucune route : sans celle-ci, le routeur
      // recevrait les appels du serveur sans savoir lui répondre.
      expect(invitation.script).toContain('/ip/route/add dst-address=10.88.0.0/24');

      // Documenté comme un entier : « 25s » serait refusé sous cette lecture,
      // « 25 » vaut 25 secondes dans les deux cas.
      expect(invitation.script).toContain('persistent-keepalive=25 ');
    });

    it('stocke le jeton haché, jamais en clair', async () => {
      const invitation = await asA(() => service.invite('Routeur Betania'));
      const token = invitation.script.match(/callback\/([A-Za-z0-9_-]+)"/)![1];

      const row = await prisma.routerEnrollment.findUniqueOrThrow({
        where: { id: invitation.id },
      });
      expect(row.tokenHash).not.toBe(token);
      expect(row.tokenHash).toHaveLength(64);
      // Le mot de passe d'API non plus ne dort pas en clair.
      expect(row.credentialsEncrypted).not.toContain('gemikrot-api');
    });

    it("n'attribue jamais deux fois la même adresse, ni celle du serveur", async () => {
      const addresses = new Set<string>();
      for (let i = 0; i < 3; i += 1) {
        const invitation = await asA(() => service.invite(`Routeur ${i}`));
        addresses.add(invitation.tunnelAddress);
      }

      expect(addresses.size).toBe(3);
      expect(addresses.has('10.88.0.1')).toBe(false);
      // Le plan d'adressage est commun : une invitation d'un autre exploitant
      // réserve l'adresse tout autant.
      const other = await tenantContext.runAsTenant(tenantB, () => service.invite('Chez B'));
      expect(addresses.has(other.tunnelAddress)).toBe(false);
    });
  });

  describe('rappel du routeur', () => {
    it('crée le routeur chez le bon exploitant et brûle le jeton', async () => {
      const invitation = await tenantContext.runAsTenant(tenantB, () =>
        service.invite('Routeur B'),
      );
      const token = invitation.script.match(/callback\/([A-Za-z0-9_-]+)"/)![1];

      // Le routeur appelle sans aucun contexte : c'est le jeton, et lui seul,
      // qui détermine l'exploitant.
      const result = await service.consume(token, {
        publicKey: routerKey('b'),
        identity: 'hAP-Betania',
      });

      const router = await prisma.router.findUniqueOrThrow({ where: { id: result.routerId } });
      expect(router.tenantId).toBe(tenantB);
      expect(router.label).toBe('hAP-Betania');
      // L'hôte est l'adresse du tunnel : hors tunnel, l'API n'est plus là.
      expect(router.host).toBe(invitation.tunnelAddress);
      expect(router.tunnelPublicKey).toBe(routerKey('b'));

      // Rejouer le script ne doit pas créer un second routeur.
      await expect(service.consume(token, { publicKey: routerKey('b') })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuse un jeton expiré', async () => {
      const invitation = await asA(() => service.invite('Routeur périmé'));
      const token = invitation.script.match(/callback\/([A-Za-z0-9_-]+)"/)![1];
      await prisma.routerEnrollment.update({
        where: { id: invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(service.consume(token, { publicKey: routerKey('c') })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('refuse un jeton inventé, sans rien dire de plus', async () => {
      // Même réponse qu'un jeton expiré ou déjà servi : rien ne doit se
      // distinguer en tâtonnant.
      await expect(
        service.consume('jeton-invente', { publicKey: routerKey('d') }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuse une clé publique qui n\'en est pas une', async () => {
      const invitation = await asA(() => service.invite('Routeur clé douteuse'));
      const token = invitation.script.match(/callback\/([A-Za-z0-9_-]+)"/)![1];

      await expect(service.consume(token, { publicKey: 'pas-une-cle' })).rejects.toThrow(
        /Clé publique/,
      );
      // Le jeton n'a pas été consommé pour autant : l'exploitant peut réessayer.
      const row = await prisma.routerEnrollment.findUniqueOrThrow({
        where: { id: invitation.id },
      });
      expect(row.consumedAt).toBeNull();
    });
  });

  it('ne fait pas semblant d\'ajouter le pair quand il ne le pilote pas', async () => {
    // Sur un poste sans `wg`, l'enrôlement aboutit mais la commande à passer
    // est rendue : le silence ferait croire le tunnel monté.
    const peer = await wireguard.addPeer({
      publicKey: routerKey('e'),
      tunnelAddress: '10.88.0.5',
    });
    expect(peer.applied).toBe(false);
    expect(peer.command).toBe('wg set wg0 peer ' + routerKey('e') + ' allowed-ips 10.88.0.5/32');
  });

  it('dit ce qui manque plutôt que de produire un script inutilisable', async () => {
    const bare = new RouterEnrollmentService(
      prisma,
      new RouterCredentialsService(config),
      new WireguardService({ get: () => undefined, getOrThrow: () => undefined } as never),
      tenantContext,
      config,
    );

    await expect(asA(() => bare.invite('Sans tunnel'))).rejects.toThrow(
      /WIREGUARD_ENDPOINT_HOST/,
    );
  });

  it("épuise proprement un plan d'adressage trop petit", async () => {
    // Un /30 sur un plan à part : deux adresses utilisables, dont celle du
    // serveur. La seconde invitation doit se heurter à un refus explicite
    // plutôt qu'attribuer une adresse déjà prise.
    const etroit = new RouterEnrollmentService(
      prisma,
      new RouterCredentialsService(config),
      new WireguardService({
        get: (key: string) =>
          ({
            ...SETTINGS,
            WIREGUARD_SUBNET: '10.99.0.0/30',
            WIREGUARD_SERVER_ADDRESS: '10.99.0.1',
          })[key],
        getOrThrow: (key: string) => SETTINGS[key],
      } as never),
      tenantContext,
      config,
    );

    const first = await asA(() => etroit.invite('Étroit 1'));
    expect(first.tunnelAddress).toBe('10.99.0.2');

    await expect(asA(() => etroit.invite('Étroit 2'))).rejects.toBeInstanceOf(ConflictException);
  });
});
