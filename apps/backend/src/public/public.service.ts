import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentStatus, PlanKind, PlanStatus, TenantStatus, VoucherTarget } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { PageConnexionService } from '../hotspot/page-connexion.service.js';
import { identifiantDepuisNom, identifiantUtilisable } from './identifiant.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { CourrielService } from '../courriel/courriel.service.js';
import {
  isUsablePhone,
  isUsableReference,
  normalizePhone,
  normalizeReference,
} from './payment-normalization.js';

/**
 * L'hote tel qu'on peut le comparer a un domaine enregistre.
 *
 * Le navigateur envoie parfois un port (`wifitati.net:8080`), parfois une
 * majuscule, et le proxy peut ajouter des espaces. Un domaine saisi a la main
 * dans les reglages n'aura rien de tout cela : sans normalisation, les deux ne
 * se rencontrent jamais et la resolution echoue en silence.
 *
 * Rend une chaine vide pour ce qui ne peut pas etre un domaine -- une adresse
 * IP, `localhost`, ou n'importe quoi de vide. Non par prudence de principe :
 * la console de developpement repond sur `localhost`, et la laisser resoudre
 * vers une vitrine rendrait l'ecran de connexion inatteignable.
 */
/**
 * L'hôte d'une adresse, port compris : `192.168.88.135:5173`.
 *
 * Le port est gardé, contrairement à `normaliserHote` : une déclaration
 * d'adresse de paiement le porte presque toujours, et l'ignorer ferait
 * répondre la page de paiement sur n'importe quel autre service de la même
 * machine — à commencer par la console.
 */
export function hoteAvecPort(url: string): string {
  try {
    const u = new URL(url.includes('://') ? url : `http://${url}`);
    return u.host.toLowerCase();
  } catch {
    return '';
  }
}

export function normaliserHote(hote: string | undefined | null): string {
  const brut = (hote ?? '').trim().toLowerCase();
  // Le port d'abord : `[::1]:5173` doit perdre son port avant tout test.
  const sansPort = brut.replace(/:\d+$/, '');
  if (!sansPort || sansPort === 'localhost' || sansPort.endsWith('.localhost')) return '';
  // Une adresse IP n'est pas un domaine : le portail captif sert la console
  // par son adresse, et elle doit rester la console.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(sansPort)) return '';
  if (sansPort.startsWith('[') || sansPort.includes(':')) return '';
  if (!sansPort.includes('.')) return '';
  return sansPort;
}

export interface PublicTenantView {
  wifiName: string;
  logoUrl: string | null;
  currency: string;
  plans: {
    id: string;
    name: string;
    description: string | null;
    price: string;
    validityDurationSeconds: number;
    maxSharedUsers: number | null;
  }[];
  paymentAccounts: { id: string; provider: string; phoneNumber: string; accountName: string }[];
  /**
   * Numéro WhatsApp d'assistance, ou `null`.
   *
   * `null` plutôt qu'une chaîne vide : la page n'affiche le lien que s'il y
   * a un numéro, et une porte d'assistance qui ne mène nulle part est pire
   * que pas d'assistance annoncée.
   */
  supportWhatsapp: string | null;
}

export type ClaimState = 'EN_ATTENTE' | 'VALIDE' | 'REFUSE';

export interface ClaimView {
  state: ClaimState;
  /** Rendu seulement une fois le paiement vérifié. */
  accessCode: string | null;
  /**
   * Le mot de passe, quand il diffère du code.
   *
   * `null` sur un ticket imprimé, où le code sert des deux côtés. Sur un
   * achat en ligne, il porte la référence du transfert : le client ne l'a
   * pas à retenir, il l'a déjà.
   */
  accessPassword: string | null;
  planName: string;
  amount: string;
  currency: string;
  createdAt: string;
}

/**
 * Ce que voit un client qui n'est pas connecté : la vitrine de l'exploitant
 * et le suivi de son paiement.
 *
 * **Cloisonnement.** Aucune requête ici ne s'appuie sur un jeton — il n'y en
 * a pas. Chaque méthode a donc pour corps un unique `runAsTenant`, explicite
 * et greppable, et n'utilise à l'intérieur que `scopedStrict`, qui refuse de
 * travailler hors d'un exploitant. Le cloisonnement de la plateforme ne doit
 * pas dépendre de l'ordre d'exécution d'un intercepteur.
 */
@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    /**
     * Facultatif, et il faut qu'il le soit.
     *
     * Ce service est éprouvé contre la vraie base, construit à la main dans
     * ses tests. Le rendre obligatoire ferait de l'envoi de courriel une
     * condition pour déclarer un paiement — et un paiement qu'on ne peut pas
     * déclarer parce qu'un serveur SMTP manque serait un client perdu pour
     * une raison qui ne le regarde pas.
     */
    private readonly courriel?: CourrielService,
    /**
     * Facultatif pour la meme raison que le courriel : ce service est eprouve
     * contre la vraie base, construit a la main dans ses tests, et servir la
     * page captive n'est pas une condition pour declarer un paiement.
     */
    private readonly pageConnexion?: PageConnexionService,
  ) {}

  /**
   * La page de connexion du portail, servie au routeur lui-meme.
   *
   * Le routeur va la chercher par `/tool/fetch` et l'ecrit dans son dossier
   * HotSpot. C'est le chemin de repli quand la console ne peut pas l'ecrire
   * par l'API -- et c'est aussi le plus simple : une ligne de script au lieu
   * de dix kilo-octets de HTML a coller dans un terminal.
   *
   * Publique, et elle peut l'etre : c'est exactement la page que voit
   * n'importe quel client du reseau avant de se connecter. Elle ne porte que
   * la marque de l'exploitant, ses tarifs et l'adresse de sa page de
   * paiement -- rien qu'un passant du quartier ne puisse deja lire.
   */
  async pageCaptive(slug: string): Promise<string> {
    const tenant = await this.requireActiveTenant(slug);
    if (!this.pageConnexion) {
      throw new NotFoundException('Page de connexion indisponible sur ce serveur');
    }
    return this.tenantContext.runAsTenant(tenant.id, async () => {
      const { contenu } = await this.pageConnexion!.apercu();
      return contenu;
    });
  }

  /**
   * Prévient les administrateurs qu'un client attend son code.
   *
   * C'est la panne la plus chère du produit : un paiement déclaré qui dort
   * trois jours parce que personne n'a ouvert le bon écran. Relevé sur ce
   * parc — deux clients dans ce cas.
   *
   * N'interrompt jamais la déclaration : le client a payé, son paiement doit
   * être enregistré même si aucun courriel ne part. L'échec est tracé dans le
   * journal des envois, où il se voit.
   */
  private async prevenirLesAdmins(
    tenantId: string,
    quoi: { offre: string; identifiant: string; reference: string },
  ): Promise<void> {
    if (!this.courriel) return;
    try {
      const admins = await this.prisma.adminUser.findMany({
        // Les comptes qui peuvent agir sur le paiement, et eux seuls : prevenir
        // un lecteur seul le laisserait devant une alerte qu'il ne peut pas
        // lever, et diluerait celles qui comptent.
        where: { tenantId, role: { in: ['SUPER_ADMIN', 'ADMIN'] } },
        select: { email: true },
      });
      for (const admin of admins) {
        await this.courriel.envoyer({
          tenantId,
          destinataire: admin.email,
          sujet: `Paiement à vérifier — ${quoi.offre}`,
          texte:
            `Un client vient de déclarer un paiement et attend son accès.\n\n` +
            `Offre : ${quoi.offre}\n` +
            `Identifiant : ${quoi.identifiant}\n` +
            `Référence : ${quoi.reference}\n\n` +
            `Tant qu'il n'est pas vérifié, ce client a payé et n'a rien reçu.\n\n` +
            `— GeMikrot`,
          type: 'paiement-declare',
        });
      }
    } catch (e) {
      // Tracé et oublié : prévenir est un accessoire, encaisser ne l'est pas.
      this.logger.warn(
        `Avertissement des administrateurs impossible : ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /**
   * L'exploitant à qui appartient cette adresse.
   *
   * Les domaines étaient enregistrés — ils s'impriment même sur le QR des
   * tickets — mais rien ne s'en servait pour répondre. Un client qui tapait
   * l'adresse de son fournisseur tombait sur l'écran de connexion de la
   * console : une page d'administration, dans une langue qui n'est pas la
   * sienne, sans aucun rapport avec ce qu'il cherchait.
   *
   * Rendre le slug plutôt que la vitrine elle-même : l'appelant redirige, et
   * l'adresse qui s'affiche reste celle qui marche partout — celle qu'on peut
   * recopier, mettre en favori, ou coller dans le Walled Garden.
   */
  async slugParHote(hote: string): Promise<{ slug: string } | null> {
    /**
     * D'abord l'adresse que l'exploitant a **déclarée** comme sa page de
     * paiement, dans les réglages du portail captif.
     *
     * Elle est très souvent une adresse IP, que la résolution par domaine
     * écarte à raison — le portail captif sert la console par son adresse, et
     * la laisser résoudre toute seule rendrait l'écran de connexion
     * inatteignable. Ici c'est différent : l'exploitant a désigné cette
     * adresse comme étant sa page de paiement. Ce n'est plus une supposition,
     * c'est une déclaration, et c'est ce qui permet au bouton du portail de
     * pointer sur une adresse nue — sans `/p/<identifiant>` à la traîne.
     *
     * Comparée **avec son port** : deux services sur la même machine ne sont
     * pas le même site, et la console elle-même en est un.
     */
    const complet = (hote ?? '').trim().toLowerCase().replace(/\/+$/, '');
    if (complet) {
      const declarations = await this.prisma.hotspotLoginPage.findMany({
        where: { portailUrl: { not: null } },
        select: { portailUrl: true, tenant: { select: { slug: true, status: true } } },
      });
      const declare = declarations.find(
        (d) =>
          d.tenant.status === TenantStatus.ACTIVE &&
          hoteAvecPort(d.portailUrl ?? '') === complet,
      );
      if (declare) return { slug: declare.tenant.slug };
    }

    const normalisé = normaliserHote(hote);
    if (!normalisé) return null;

    // `www.` et le domaine nu désignent le même site pour qui le tape. En
    // enregistrer un seul et se voir refuser l'autre serait incompréhensible.
    const candidats = normalisé.startsWith('www.')
      ? [normalisé, normalisé.slice(4)]
      : [normalisé, `www.${normalisé}`];

    const tenant = await this.prisma.tenant.findFirst({
      where: { status: TenantStatus.ACTIVE, domains: { hasSome: candidats } },
      select: { slug: true },
    });

    return tenant ? { slug: tenant.slug } : null;
  }

  /**
   * Vitrine : la marque, les offres à la vente, et où payer.
   *
   * Construite à la main, jamais renvoyée depuis une entité : l'identifiant
   * de l'exploitant, ses domaines, son statut et ses puces désactivées n'ont
   * rien à faire dans une réponse publique.
   */
  async getTenantView(slug: string): Promise<PublicTenantView> {
    const tenant = await this.requireActiveTenant(slug);

    return this.tenantContext.runAsTenant(tenant.id, async () => {
      const [plans, accounts] = await Promise.all([
        this.prisma.scopedStrict.plan.findMany({
          where: { status: PlanStatus.ACTIVE, kind: PlanKind.TICKET },
          select: {
            id: true,
            name: true,
            description: true,
            price: true,
            validityDurationSeconds: true,
            maxSharedUsers: true,
          },
          orderBy: { price: 'asc' },
        }),
        this.prisma.scopedStrict.mobileMoneyAccount.findMany({
          // Une puce retirée ne doit plus être proposée : l'argent y
          // arriverait sans que personne ne le voie.
          where: { isActive: true },
          select: { id: true, provider: true, phoneNumber: true, accountName: true },
        }),
      ]);

      return {
        wifiName: tenant.wifiName,
        logoUrl: tenant.logoUrl,
        currency: tenant.currency,
        supportWhatsapp: tenant.supportWhatsapp || null,
        plans: plans.map((plan) => ({ ...plan, price: plan.price.toString() })),
        paymentAccounts: accounts,
      };
    });
  }

  /**
   * Le client déclare avoir payé. Rien ne lui est ouvert à ce stade : un
   * paiement en attente est enregistré, que la lecture des SMS ou un admin
   * viendra confirmer.
   */
  async claim(
    slug: string,
    input: {
      planId: string;
      accountId: string;
      phone: string;
      reference: string;
      holderName: string;
    },
  ): Promise<{ token: string; state: ClaimState; identifiant: string }> {
    const tenant = await this.requireActiveTenant(slug);

    const phone = normalizePhone(input.phone);
    const reference = normalizeReference(input.reference);
    if (!isUsablePhone(phone)) {
      throw new BadRequestException('Numéro de téléphone invalide');
    }
    if (!isUsableReference(reference)) {
      throw new BadRequestException(
        'Référence invalide — entre 4 et 32 lettres ou chiffres, telle qu\'elle figure dans votre SMS',
      );
    }

    // L'identifiant se décide **ici**, avant le paiement. Un nom impossible
    // découvert à la vérification laisserait un client qui a payé sans accès
    // et sans recours.
    const identifiant = identifiantDepuisNom(input.holderName);
    if (!identifiantUtilisable(identifiant)) {
      throw new BadRequestException(
        'Nom inutilisable comme identifiant — au moins trois lettres, sans caractères spéciaux',
      );
    }

    return this.tenantContext.runAsTenant(tenant.id, async () => {
      // Le cloisonnement suffit à écarter l'offre d'un autre exploitant :
      // un identifiant recopié d'ailleurs ne sera simplement pas trouvé.
      const plan = await this.prisma.scopedStrict.plan.findFirst({
        where: { id: input.planId, status: PlanStatus.ACTIVE, kind: PlanKind.TICKET },
      });
      if (!plan) throw new NotFoundException('Offre introuvable');

      const account = await this.prisma.scopedStrict.mobileMoneyAccount.findFirst({
        where: { id: input.accountId, isActive: true },
      });
      if (!account) throw new NotFoundException('Moyen de paiement introuvable');

      // Rejouer la même demande ne crée pas un second paiement : le client
      // qui recharge la page retrouve simplement son suivi.
      const existing = await this.prisma.scopedStrict.payment.findFirst({
        where: { reference, method: account.provider },
        include: { claim: true, voucher: { select: { code: true } } },
      });
      if (existing?.claim) {
        // Le client qui recharge la page retrouve **l'identifiant qui lui a
        // été réservé**, et non celui que son nom donnerait aujourd'hui : il
        // a pu le retaper autrement, et c'est l'ancien qui existe.
        return {
          token: existing.claim.token,
          state: this.stateOf(existing.status),
          identifiant: existing.voucher?.code ?? identifiant,
        };
      }
      if (existing) {
        throw new BadRequestException(
          'Cette référence a déjà été utilisée. Contactez le vendeur si vous pensez que c\'est une erreur.',
        );
      }

      // L'identifiant est unique sur toute la plateforme : `code` l'est déjà
      // pour les tickets imprimés, et le routeur ne saurait pas distinguer
      // deux comptes du même nom. On refuse donc **avant** le paiement, avec
      // de quoi s'en sortir, plutôt que de laisser le client payer pour rien.
      // Créé avant la branche de reprise : elle en a besoin pour rattacher le
      // paiement, et le nom qu'il vient de saisir vaut mieux que celui d'une
      // déclaration précédente.
      const customer = await this.prisma.scopedStrict.customer.upsert({
        where: { tenantId_phone: { tenantId: tenant.id, phone } },
        update: { name: input.holderName.trim() },
        create: { tenantId: tenant.id, name: input.holderName.trim(), phone },
      });

      // Hors cloisonnement, et à dessein : la collision d'identifiant se
      // cherche chez tout le monde. L'appartenance est revérifiée juste après
      // — `luiMême` compare le `tenantId` — et rien de cette ligne ne sort
      // d'ici : seul le fait que le nom soit pris est dit au client.
      const déjàPris = await this.prisma.voucher.findFirst({
        // **Insensible à la casse**, et c'est un vrai piège : l'index unique
        // de Postgres, lui, distingue `Naivo-Doublon` de `naivo-doublon`. La
        // base accepterait donc les deux, et deux clients croiraient chacun
        // posséder le même identifiant. Trouvé par le test qui rejoue le même
        // nom en minuscules.
        where: { code: { equals: identifiant, mode: 'insensitive' } },
        select: { id: true, code: true, tenantId: true, status: true, customer: { select: { phone: true } } },
      });

      if (déjàPris) {
        /**
         * Le même identifiant **et** le même numéro : c'est le client qui
         * revient. Il rachète du temps sur l'accès qu'il a déjà, et n'a ni
         * nouveau nom à inventer ni formulaire séparé à trouver.
         *
         * **Le numéro est la preuve, et il n'y en a pas d'autre.** Sans lui,
         * il suffirait de taper le nom de son voisin et de payer pour le
         * mettre dehors : son mot de passe deviendrait une référence qu'il ne
         * connaît pas, et il n'aurait aucun moyen de comprendre pourquoi son
         * code « ne marche plus ». Le formulaire demande déjà ce numéro —
         * aucun champ de plus à remplir pour s'en servir.
         */
        const luiMeme =
          déjàPris.tenantId === tenant.id && déjàPris.customer?.phone === phone;

        if (!luiMeme) {
          throw new BadRequestException(
            `« ${déjàPris.code} » est déjà utilisé. Ajoutez votre initiale ou un chiffre, par exemple « ${identifiant}2 ».`,
          );
        }
        if (déjàPris.status === 'CANCELLED' || déjàPris.status === 'DISABLED') {
          throw new BadRequestException(
            'Cet accès a été bloqué. Contactez le vendeur : un nouveau paiement ne le rouvrirait pas.',
          );
        }

        const paiement = await this.prisma.scopedStrict.payment.create({
          data: {
            tenantId: tenant.id,
            customerId: customer.id,
            planId: plan.id,
            amount: plan.price,
            currency: tenant.currency,
            method: account.provider,
            reference,
            // `renewsVoucherId`, et non `voucherId` : celui-là est unique,
            // parce qu'un ticket ne se vend qu'une fois. Racheter du temps
            // n'est pas une seconde vente, et cela peut arriver tous les mois.
            renewsVoucherId: déjàPris.id,
          },
        });

        const suivi = await this.prisma.scopedStrict.paymentClaim.create({
          data: {
            tenantId: tenant.id,
            paymentId: paiement.id,
            token: randomBytes(24).toString('base64url'),
            phone,
            reference,
          },
        });

        this.logger.log(
          `Temps racheté : ${plan.name} pour ${déjàPris.code} (${account.provider})`,
        );
        await this.prevenirLesAdmins(tenant.id, {
          offre: plan.name,
          identifiant: déjàPris.code,
          reference,
        });
        return { token: suivi.token, state: 'EN_ATTENTE' as const, identifiant: déjàPris.code };
      }

      // Le ticket est créé **maintenant**, au nom choisi et avec la référence
      // pour mot de passe. Il n'est poussé sur le routeur qu'à la
      // vérification du paiement : rien ne s'ouvre avant que l'argent soit
      // constaté. Le créer ici est ce qui réserve l'identifiant.
      const voucher = await this.prisma.scopedStrict.voucher.create({
        data: {
          tenantId: tenant.id,
          code: identifiant,
          accessPassword: reference,
          planId: plan.id,
          price: plan.price,
          customerId: customer.id,
          // User Manager, seul à tenir une validité calendaire : elle court
          // même client déconnecté, et c'est celle qu'il a payée.
          target: VoucherTarget.USER_MANAGER,
        },
      });

      const payment = await this.prisma.scopedStrict.payment.create({
        data: {
          tenantId: tenant.id,
          customerId: customer.id,
          planId: plan.id,
          amount: plan.price,
          currency: tenant.currency,
          method: account.provider,
          reference,
          // Rattaché dès la déclaration : c'est ce ticket-là que la
          // vérification ouvrira, et non un tiré du stock. Sans ce lien, le
          // client recevrait un code aléatoire à la place de son nom.
          voucherId: voucher.id,
        },
      });

      const claim = await this.prisma.scopedStrict.paymentClaim.create({
        data: {
          tenantId: tenant.id,
          paymentId: payment.id,
          token: randomBytes(24).toString('base64url'),
          phone,
          reference,
        },
      });

      this.logger.log(
        `Paiement déclaré : ${plan.name} par ${phone} (${account.provider}), identifiant ${identifiant}`,
      );
      await this.prevenirLesAdmins(tenant.id, {
        offre: plan.name,
        identifiant,
        reference,
      });
      return { token: claim.token, state: 'EN_ATTENTE' as const, identifiant };
    });
  }

  /** Suivi par jeton, pour le navigateur qui vient de déclarer le paiement. */
  async getClaimByToken(slug: string, token: string): Promise<ClaimView> {
    const tenant = await this.requireActiveTenant(slug);

    return this.tenantContext.runAsTenant(tenant.id, async () => {
      const claim = await this.prisma.scopedStrict.paymentClaim.findFirst({
        where: { token },
        include: { payment: { include: { plan: true, voucher: true } } },
      });
      if (!claim) throw new NotFoundException('Suivi introuvable');
      return this.toView(claim);
    });
  }

  /**
   * Retrouver son accès avec ce qu'on a en main : son numéro et sa
   * référence. C'est une **recherche**, pas une authentification : elle ne
   * crée aucun compte et ne renvoie que ce que le client a déjà payé.
   */
  async lookup(slug: string, input: { phone: string; reference: string }): Promise<ClaimView> {
    const tenant = await this.requireActiveTenant(slug);
    const phone = normalizePhone(input.phone);
    const reference = normalizeReference(input.reference);

    return this.tenantContext.runAsTenant(tenant.id, async () => {
      const claim = await this.prisma.scopedStrict.paymentClaim.findFirst({
        where: { phone, reference },
        include: { payment: { include: { plan: true, voucher: true } } },
      });
      if (!claim) {
        throw new NotFoundException(
          'Aucun paiement trouvé pour ce numéro et cette référence. Vérifiez votre SMS.',
        );
      }
      return this.toView(claim);
    });
  }

  /**
   * L'exploitant est résolu sur le client brut : `Tenant` n'est pas un
   * modèle cloisonné, et c'est justement cette requête qui détermine le
   * cloisonnement de tout le reste.
   *
   * Un exploitant inconnu et un exploitant non activé donnent la même
   * réponse — 404 — pour ne pas révéler quels comptes existent.
   */
  private async requireActiveTenant(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status !== TenantStatus.ACTIVE) {
      throw new NotFoundException('Page introuvable');
    }
    return tenant;
  }

  private toView(claim: {
    createdAt: Date;
    payment: {
      status: PaymentStatus;
      amount: unknown;
      currency: string;
      plan: { name: string };
      voucher: { code: string; accessPassword: string | null } | null;
    };
  }): ClaimView {
    const state = this.stateOf(claim.payment.status);
    return {
      state,
      // Le code n'est rendu qu'après vérification : un jeton de suivi peut
      // être partagé, il ne doit pas donner d'accès à lui seul.
      accessCode: state === 'VALIDE' ? (claim.payment.voucher?.code ?? null) : null,
      accessPassword: state === 'VALIDE' ? (claim.payment.voucher?.accessPassword ?? null) : null,
      planName: claim.payment.plan.name,
      amount: String(claim.payment.amount),
      currency: claim.payment.currency,
      createdAt: claim.createdAt.toISOString(),
    };
  }

  private stateOf(status: PaymentStatus): ClaimState {
    if (status === PaymentStatus.VERIFIED) return 'VALIDE';
    if (status === PaymentStatus.PENDING) return 'EN_ATTENTE';
    return 'REFUSE';
  }
}
