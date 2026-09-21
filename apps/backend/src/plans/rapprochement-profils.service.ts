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
    const profil = await this.profilVendable(nomProfil, routerId);

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

  /**
   * Met le profil au tarif que voient les clients.
   *
   * La page de paiement ne lit que les offres de l'application : un profil
   * cree dans WinBox n'y apparait jamais, et c'est ce qui faisait diverger
   * les deux listes sans qu'aucun geste ne les rapproche. Ce bouton est ce
   * geste, dans le sens qui manquait -- du routeur vers la vitrine.
   *
   * **Rien n'est ecrit sur le routeur.** Le profil existe deja, il sert deja
   * des clients : on se contente de le vendre. Le sens inverse -- pousser une
   * offre vers User Manager -- reste « Synchroniser », dans l'ecran Offres.
   *
   * Un profil sans prix est refuse : il s'afficherait a 0 Ar et se vendrait
   * pour rien. C'est le seul cas ou l'exploitant doit d'abord passer par
   * WinBox, et le message le dit.
   */
  async publierAuTarif(
    nomProfil: string,
    adminUserId: string,
    routerId?: string,
  ): Promise<{ id: string; nom: string; cree: boolean }> {
    const profil = await this.profilVendable(nomProfil, routerId);
    const existante = await this.offreDuProfil(nomProfil);

    if (existante) {
      // Un abonnement ne se vend pas en libre-service : il se renouvelle au
      // comptoir, et la page publique ne le propose pas. Basculer son genre
      // pour l'y faire entrer changerait ce qu'il est, sans que personne ne
      // l'ait demande.
      if (existante.kind === PlanKind.SUBSCRIPTION) {
        throw new BadRequestException(
          `« ${existante.name} » est un abonnement : il se renouvelle au comptoir et n'a pas sa place sur la page de paiement, qui ne vend que des accès à durée.`,
        );
      }
      // Le prix de l'offre est conserve, pas ecrase par celui du profil :
      // c'est lui qui a servi aux ventes passees, et l'aligner en silence sur
      // WinBox pourrait baisser un tarif que l'exploitant avait releve.
      if (Number(existante.price) <= 0 || existante.priceNeedsReview) {
        throw new BadRequestException(
          `Le prix de l'offre « ${existante.name} » n'est pas confirmé : elle s'afficherait à un tarif que personne n'a validé. Ouvrez l'écran Offres, posez son prix, puis remettez-la au tarif.`,
        );
      }

      const offre = await this.prisma.scoped.plan.update({
        where: { id: existante.id },
        data: {
          status: PlanStatus.ACTIVE,
          // Le rattachement explicite, sans quoi l'offre resterait un simple
          // homonyme du profil -- l'etat que cet ecran sert justement a lever.
          umProfileName: nomProfil,
          umSyncedAt: new Date(),
        },
      });

      await this.audit.log({
        adminUserId,
        routerId,
        action: 'PUBLISH_PLAN_TARIFF',
        targetType: 'Plan',
        targetId: offre.id,
        payloadDiff: { profil: nomProfil, statutPrecedent: existante.status },
      });

      return { id: offre.id, nom: offre.name, cree: false };
    }

    if (profil.price == null || profil.price <= 0) {
      throw new BadRequestException(
        `Le profil « ${nomProfil} » n'a pas de prix : il s'afficherait à 0 Ar sur la page de paiement, et se vendrait pour rien. Posez son prix, puis remettez-le au tarif.`,
      );
    }

    const offre = await this.prisma.scoped.plan.create({
      data: {
        tenantId: this.tenantContext.requireTenantId(),
        name: nomProfil,
        price: profil.price,
        validityDurationSeconds: profil.validityDurationSeconds,
        startsWhen:
          profil.startsWhen === 'assigned'
            ? ProfileStartsWhen.ASSIGNED
            : ProfileStartsWhen.FIRST_AUTH,
        maxSharedUsers: profil.overrideSharedUsers ?? undefined,
        mikrotikProfileName: nomProfil,
        umProfileName: nomProfil,
        umSyncedAt: new Date(),
        // Active, contrairement a « Creer l'offre » : ici le geste demande
        // explicitement la mise en vente, et naitre archivee obligerait a
        // aller la chercher dans un autre ecran pour l'activer.
        status: PlanStatus.ACTIVE,
        kind: PlanKind.TICKET,
      },
    });

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'PUBLISH_PLAN_TARIFF',
      targetType: 'Plan',
      targetId: offre.id,
      payloadDiff: { profil: nomProfil, prix: String(profil.price), creee: true },
    });

    return { id: offre.id, nom: offre.name, cree: true };
  }

  /**
   * Retire le profil du tarif public.
   *
   * L'offre est archivee, jamais supprimee : les tickets deja vendus sur ce
   * profil continuent de fonctionner -- le routeur ne connait que le profil,
   * et le profil reste -- et les recettes gardent a quoi se rattacher.
   */
  async retirerDuTarif(
    nomProfil: string,
    adminUserId: string,
    routerId?: string,
  ): Promise<{ id: string; nom: string }> {
    const offre = await this.offreDuProfil(nomProfil);
    if (!offre) {
      throw new BadRequestException(
        `Aucune offre ne vend le profil « ${nomProfil} » : il n'est déjà pas au tarif.`,
      );
    }

    const archivee = await this.prisma.scoped.plan.update({
      where: { id: offre.id },
      data: { status: PlanStatus.ARCHIVED },
    });

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'WITHDRAW_PLAN_TARIFF',
      targetType: 'Plan',
      targetId: offre.id,
      payloadDiff: { profil: nomProfil },
    });

    return { id: archivee.id, nom: archivee.name };
  }

  /**
   * Le profil du routeur, verifie vendable.
   *
   * Sans validite, RouterOS ne sait pas quand couper : l'offre se vendrait
   * sans fin d'acces, et aucun ecran ne rattraperait ensuite.
   */
  private async profilVendable(nomProfil: string, routerId?: string) {
    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();

    const profil = (await mikrotik.getUserManagerProfiles()).find((p) => p.name === nomProfil);
    if (!profil) {
      throw new BadRequestException(
        `Le profil « ${nomProfil} » n'existe pas sur le routeur`,
      );
    }
    if (profil.validityDurationSeconds == null) {
      throw new BadRequestException(
        `Le profil « ${nomProfil} » n'a pas de validité : il ne peut pas devenir une offre`,
      );
    }
    // Reconstruit plutot que renvoye tel quel : le rétrécissement de type
    // obtenu par le `throw` ci-dessus ne franchit pas la frontière de la
    // méthode, et les appelants retrouveraient une validité « peut-être
    // nulle » qu'ils viennent pourtant de faire vérifier.
    return { ...profil, validityDurationSeconds: profil.validityDurationSeconds };
  }

  /**
   * L'offre qui vend ce profil, rattachement explicite d'abord.
   *
   * L'homonyme compte aussi : une offre qui porte le nom du profil sans y
   * etre reliee est bien celle qu'on republie, et en creer une seconde
   * ferait deux lignes pour un seul tarif -- exactement ce que cet ecran
   * sert a eviter.
   */
  private async offreDuProfil(nomProfil: string) {
    const rattachee = await this.prisma.scoped.plan.findFirst({
      where: { umProfileName: nomProfil },
    });
    if (rattachee) return rattachee;

    return this.prisma.scoped.plan.findFirst({
      where: { OR: [{ name: nomProfil }, { mikrotikProfileName: nomProfil }] },
    });
  }
}
