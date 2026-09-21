import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PlanKind, PlanStatus, ProfileStartsWhen } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * Les profils du routeur en face des offres de l'application.
 *
 * Les deux listes divergent, et rien ne le montrait. Il fallait ouvrir
 * WinBox à côté de la console pour s'apercevoir qu'une offre vendue
 * publiquement n'a pas de profil en face, ou qu'un profil créé à la main
 * dans WinBox n'est vendu nulle part.
 *
 * **Les deux sens comptent, et pas pour la même raison.**
 *
 * Une offre sans profil est un risque commercial : elle est vendable, et
 * c'est au moment de livrer que l'on découvre le manque.
 *
 * Un profil sans offre est de l'argent laissé de côté : l'exploitant l'a
 * créé pour vendre quelque chose, et ce quelque chose n'apparaît sur aucune
 * page. C'est le cas de ce parc — deux profils User Manager ne
 * correspondent à aucune offre.
 */

export interface OffreRapprochee {
  id: string;
  nom: string;
  statut: PlanStatus;
  genre: PlanKind;
  prix: string;
  /** Le profil User Manager visé, et s'il existe sur le routeur. */
  profilUm: string | null;
  profilUmPresent: boolean;
  /** Le profil HotSpot visé, et s'il existe sur le routeur. */
  profilHotspot: string;
  profilHotspotPresent: boolean;
  /** Vendue au public : c'est là que l'absence coûte de l'argent. */
  auPublic: boolean;
}

export interface ProfilSansOffre {
  nom: string;
  validiteSecondes: number | null;
  prix: number | null;
  demarre: 'first-auth' | 'assigned' | string;
  appareils: number | null;
}

export interface Rapprochement {
  offres: OffreRapprochee[];
  profilsUmSansOffre: ProfilSansOffre[];
  /** Noms des profils HotSpot sans offre. Moins graves : ils ne se vendent pas. */
  profilsHotspotSansOffre: string[];
}

@Injectable()
export class RapprochementProfilsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
  ) {}

  async rapprocher(routerId?: string): Promise<Rapprochement> {
    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();

    const [offres, profilsUm, profilsHotspot] = await Promise.all([
      this.prisma.scoped.plan.findMany({ orderBy: { name: 'asc' } }),
      mikrotik.getUserManagerProfiles(),
      mikrotik.getHotspotProfiles(),
    ]);

    const nomsUm = new Set(profilsUm.map((p) => p.name));
    const nomsHotspot = new Set(profilsHotspot.map((p) => p.name));
    const utilisésUm = new Set<string>();
    const utilisésHotspot = new Set<string>();

    const rapprochées: OffreRapprochee[] = offres.map((o) => {
      if (o.umProfileName) utilisésUm.add(o.umProfileName);
      utilisésHotspot.add(o.mikrotikProfileName);
      return {
        id: o.id,
        nom: o.name,
        statut: o.status,
        genre: o.kind,
        prix: o.price.toString(),
        profilUm: o.umProfileName,
        profilUmPresent: o.umProfileName ? nomsUm.has(o.umProfileName) : false,
        profilHotspot: o.mikrotikProfileName,
        profilHotspotPresent: nomsHotspot.has(o.mikrotikProfileName),
        // Ce que la page publique propose : offres actives à ticket. C'est
        // le seul endroit où un client engage son argent tout seul.
        auPublic: o.status === PlanStatus.ACTIVE && o.kind === PlanKind.TICKET,
      };
    });

    return {
      offres: rapprochées,
      profilsUmSansOffre: profilsUm
        .filter((p) => !utilisésUm.has(p.name))
        .map((p) => ({
          nom: p.name,
          validiteSecondes: p.validityDurationSeconds,
          prix: p.price,
          demarre: p.startsWhen,
          appareils: p.overrideSharedUsers,
        })),
      profilsHotspotSansOffre: profilsHotspot
        .filter((p) => !utilisésHotspot.has(p.name))
        .map((p) => p.name),
    };
  }

  /**
   * Crée une offre à partir d'un profil du routeur.
   *
   * Le profil porte déjà tout ce qu'il faut : durée, prix, quand la validité
   * démarre, nombre d'appareils. Le retaper à la main dans un formulaire
   * serait l'occasion de se tromper d'un chiffre, sur une offre que le
   * routeur applique déjà.
   *
   * L'offre naît **archivée**. Elle n'apparaît donc ni sur la page publique
   * ni dans les écrans de vente tant que l'exploitant ne l'a pas relue :
   * créer une offre vendable depuis un écran de diagnostic serait mettre en
   * vente sans l'avoir décidé.
   */
  async creerOffreDepuisProfil(
    nomProfil: string,
    adminUserId: string,
    routerId?: string,
  ): Promise<{ id: string; nom: string }> {
    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();

    const profil = (await mikrotik.getUserManagerProfiles()).find((p) => p.name === nomProfil);
    if (!profil) {
      throw new BadRequestException(`Le profil « ${nomProfil} » n'existe pas sur le routeur`);
    }
    if (profil.validityDurationSeconds == null) {
      throw new BadRequestException(
        `Le profil « ${nomProfil} » n'a pas de validité : il ne peut pas devenir une offre`,
      );
    }

    const tenantId = this.tenantContext.requireTenantId();
    const existante = await this.prisma.scoped.plan.findFirst({
      where: { OR: [{ name: nomProfil }, { mikrotikProfileName: nomProfil }] },
      select: { id: true, name: true },
    });
    if (existante) {
      throw new ConflictException(`Une offre porte déjà ce nom : « ${existante.name} »`);
    }

    const offre = await this.prisma.scoped.plan.create({
      data: {
        tenantId,
        name: nomProfil,
        price: profil.price ?? 0,
        validityDurationSeconds: profil.validityDurationSeconds,
        startsWhen:
          profil.startsWhen === 'assigned'
            ? ProfileStartsWhen.ASSIGNED
            : ProfileStartsWhen.FIRST_AUTH,
        maxSharedUsers: profil.overrideSharedUsers ?? undefined,
        mikrotikProfileName: nomProfil,
        umProfileName: nomProfil,
        umSyncedAt: new Date(),
        // Archivée : relue avant d'être vendue. Voir le commentaire ci-dessus.
        status: PlanStatus.ARCHIVED,
        // Un prix de zéro veut dire que le profil n'en portait pas : il doit
        // être saisi avant toute vente, et ce drapeau le fait remonter.
        priceNeedsReview: profil.price == null || profil.price === 0,
      },
    });

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'CREATE_PLAN_FROM_PROFILE',
      targetType: 'Plan',
      targetId: offre.id,
      payloadDiff: { profil: nomProfil, prix: String(profil.price ?? 0) },
    });

    return { id: offre.id, nom: offre.name };
  }
}
