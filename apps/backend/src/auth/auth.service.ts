import {
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminRole, TenantStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LoginThrottleService } from './login-throttle.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { SignupDto } from './dto/signup.dto.js';
import type { ChangePasswordDto } from './dto/change-password.dto.js';
import { reserveTenantSlug } from '../tenants/tenant-slug.util.js';
import { ESSAI_JOURS, JOUR_MS, offreParCode } from '../tenants/offres-plateforme.js';
import { CourrielService } from '../courriel/courriel.service.js';

/** L'offre d'essai du catalogue, resolue une fois. */
const ESSAI = offreParCode('ESSAI')!;

export interface LoginResult {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: AdminRole;
    tenantId: string | null;
    /** Faux tant que le code recu par courriel n'a pas ete saisi. */
    emailVerifie: boolean;
  };
}

/**
 * Six chiffres, valables une heure.
 *
 * Six et non huit : il se lit au telephone et se retape sans erreur. L'entropie
 * est faible — un million de possibilites — mais le code ne vaut que pour une
 * adresse deja authentifiee, pendant une heure, et la limitation de debit
 * couvre le reste. Ce n'est pas un mot de passe, c'est la preuve qu'on relève
 * bien cette boite.
 */
const VALIDITE_CODE_MS = 60 * 60 * 1000;

function codeDeConfirmation(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Politique appliquée là où elle a du sens : à la définition du mot de passe. */
export const MIN_PASSWORD_LENGTH = 6;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly throttle: LoginThrottleService,
    /**
     * Facultatif, et il faut qu'il le soit.
     *
     * Le rendre obligatoire ferait d'un serveur SMTP une condition pour
     * s'inscrire : un exploitant qui ne peut pas creer son compte parce que
     * la plateforme n'a pas configure son courriel serait un client perdu
     * pour une raison qui ne le regarde pas.
     */
    private readonly courriel?: CourrielService,
  ) {}

  /**
   * Previent la plateforme qu'un exploitant vient de s'inscrire.
   *
   * Sans cela, une inscription n'atteint personne : elle attend qu'on pense a
   * ouvrir l'ecran des exploitants. C'est arrive sur cette installation — un
   * compte a dormi une journee entiere. Le compte est desormais ouvert tout
   * seul, mais savoir qui arrive reste le travail du SUPER_ADMIN.
   *
   * **Depuis le serveur de la plateforme.** La premiere version empruntait le
   * SMTP du nouvel exploitant — qui n'en a evidemment aucun a la seconde ou
   * il s'inscrit : aucun avis n'est jamais parti. La plateforme a desormais
   * le sien, et la cloche du SUPER_ADMIN reste le filet, elle qui ne depend
   * d'aucun reglage.
   */
  private async prevenirLaPlateforme(tenant: {
    id: string;
    name: string;
    wifiName: string;
    slug: string;
  }): Promise<void> {
    if (!this.courriel) return;
    try {
      const comptes = await this.prisma.adminUser.findMany({
        where: { role: AdminRole.SUPER_ADMIN },
        select: { email: true },
      });
      const texte = [
        `Un exploitant vient de s'inscrire, et son essai gratuit de ${ESSAI_JOURS} jours a commencé.`,
        '',
        `Exploitant : ${tenant.name}`,
        `Réseau Wi-Fi : ${tenant.wifiName}`,
        `Adresse publique : /p/${tenant.slug}`,
        '',
        "Il peut se connecter dès maintenant. À l'échéance, la vente se ferme ;",
        'ses clients, eux, gardent leur accès.',
        '',
        '— GeMikrot',
      ].join('\n');

      for (const compte of comptes) {
        // Depuis le serveur de la plateforme : le nouvel exploitant n'a pas
        // encore de SMTP, et l'ancien code empruntait justement le sien.
        await this.courriel.envoyerDeLaPlateforme({
          destinataire: compte.email,
          sujet: `Nouvel exploitant : ${tenant.name}`,
          texte,
          type: 'inscription-exploitant',
        });
      }
    } catch (e) {
      // Trace et oublie : prevenir est un accessoire, inscrire ne l'est pas.
      this.logger.warn(
        `Avertissement de la plateforme impossible : ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  async login(dto: LoginDto, ipAddress?: string): Promise<LoginResult> {
    // Avant toute lecture : inutile de consulter la base pour un appelant
    // qui a déjà épuisé ses essais, et cela évite d'en faire un levier.
    this.throttle.verifier(dto.email, ipAddress);

    // Client brut : l'authentification précède la résolution de l'exploitant.
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: dto.email },
      include: { tenant: true },
    });
    const passwordValid = admin ? await bcrypt.compare(dto.password, admin.passwordHash) : false;

    if (!admin || !passwordValid) {
      // Compté qu'il existe ou non : ne compter que les comptes connus dirait
      // à l'attaquant lesquels existent.
      this.throttle.echec(dto.email, ipAddress);
      await this.audit.log({
        action: 'LOGIN',
        targetType: 'AdminUser',
        targetId: admin?.id,
        ipAddress,
        result: 'FAILURE',
      });
      throw new UnauthorizedException('Identifiants invalides');
    }

    // Un exploitant non activé ne doit pas pouvoir travailler, même si ses
    // identifiants sont bons (Section : activation par le SUPER_ADMIN).
    if (admin.tenant && admin.tenant.status !== TenantStatus.ACTIVE) {
      await this.audit.log({
        adminUserId: admin.id,
        tenantId: admin.tenantId ?? undefined,
        action: 'LOGIN',
        targetType: 'AdminUser',
        targetId: admin.id,
        ipAddress,
        result: 'FAILURE',
        payloadDiff: { tenantStatus: admin.tenant.status },
      });
      throw new ForbiddenException(
        admin.tenant.status === TenantStatus.PENDING
          ? "Votre compte est en attente d'activation par l'administrateur de la plateforme"
          : 'Votre compte a été suspendu',
      );
    }

    // L'ardoise est effacée ici et non plus haut : un compte suspendu n'a
    // pas réussi à se connecter, ses essais doivent continuer de compter.
    this.throttle.succes(dto.email, ipAddress);
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.log({
      adminUserId: admin.id,
      tenantId: admin.tenantId ?? undefined,
      action: 'LOGIN',
      targetType: 'AdminUser',
      targetId: admin.id,
      ipAddress,
      result: 'SUCCESS',
    });

    return {
      accessToken: await this.signToken(admin),
      user: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        tenantId: admin.tenantId,
        emailVerifie: admin.emailVerifiedAt !== null,
      },
    };
  }

  /**
   * Changer son propre mot de passe.
   *
   * Il n'existait aucun moyen de le faire — ni ici, ni dans l'interface. Un
   * mot de passe éventé ne laissait qu'une porte de sortie : créer un autre
   * compte d'administration et supprimer l'ancien.
   *
   * L'ancien mot de passe est revérifié bien que la session soit authentifiée :
   * un écran resté ouvert ne doit pas permettre d'enfermer son propriétaire
   * dehors.
   */
  async changePassword(
    adminUserId: string,
    dto: ChangePasswordDto,
    ipAddress?: string,
  ): Promise<{ ok: true }> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });
    // Le jeton est valide mais le compte a disparu : traité comme un échec
    // d'authentification, pas comme une erreur interne.
    if (!admin) throw new UnauthorizedException('Identifiants invalides');

    const valide = await bcrypt.compare(dto.currentPassword, admin.passwordHash);
    if (!valide) {
      await this.audit.log({
        adminUserId: admin.id,
        tenantId: admin.tenantId ?? undefined,
        action: 'UPDATE',
        targetType: 'AdminUser',
        targetId: admin.id,
        ipAddress,
        result: 'FAILURE',
        payloadDiff: { champ: 'passwordHash' },
      });
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }

    if (dto.newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(
        `Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
      );
    }
    // Revalider l'ancien ne sert à rien si l'on accepte le même : le
    // changement doit changer quelque chose.
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('Le nouveau mot de passe doit être différent de l’ancien');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    await this.audit.log({
      adminUserId: admin.id,
      tenantId: admin.tenantId ?? undefined,
      action: 'UPDATE',
      targetType: 'AdminUser',
      targetId: admin.id,
      ipAddress,
      result: 'SUCCESS',
      // Jamais le mot de passe, ni son empreinte : seulement qu'il a changé.
      payloadDiff: { champ: 'passwordHash' },
    });

    return { ok: true };
  }

  /**
   * Inscription libre d'un exploitant. Le compte est créé en `PENDING` :
   * il ne devient utilisable qu'après activation par le SUPER_ADMIN.
   */
  async signup(dto: SignupDto, ipAddress?: string) {
    if (dto.password.length < MIN_PASSWORD_LENGTH) {
      throw new ConflictException(
        `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`,
      );
    }

    const existing = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    // Pose avant la transaction : la meme date pour l'echeance et la fin de
    // tolerance, sans risque qu'un ecart de millisecondes les separe.
    const finDEssai = new Date(Date.now() + ESSAI_JOURS * JOUR_MS);
    const code = codeDeConfirmation();

    const slug = await reserveTenantSlug(
      dto.organizationName,
      async (candidate) => (await this.prisma.tenant.count({ where: { slug: candidate } })) > 0,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: dto.organizationName,
          wifiName: dto.wifiName,
          domains: dto.domains ?? [],
          logoUrl: dto.logoUrl,
          currency: dto.currency,
          /**
           * L'essai **est** la porte d'entree, et il s'ouvre ici.
           *
           * Le compte restait PENDING jusqu'a une activation manuelle. Un
           * inscrit du samedi soir attendait le lundi, sans avoir rien pu
           * essayer — et si personne ne regardait l'ecran des exploitants,
           * il attendait indefiniment. C'est arrive : une inscription a
           * dormi une journee entiere sans que quiconque le sache.
           *
           * Ce qui garde la porte, ce n'est plus une validation, c'est
           * l'essai lui-meme : cinq jours, un routeur, et son propre
           * exploitant vide — il ne voit rien de personne. La suspension
           * reste au SUPER_ADMIN si quelqu'un en abuse.
           */
          status: TenantStatus.ACTIVE,
          platformPlanName: ESSAI.nom,
          maxRouters: ESSAI.maxRouteurs,
          platformEndsAt: finDEssai,
          // Pas de tolerance sur un essai : cinq jours plus quatorze feraient
          // dix-neuf jours gratuits.
          platformGraceEndsAt: finDEssai,
          mobileMoneyAccounts: dto.mobileMoneyAccounts?.length
            ? {
                create: dto.mobileMoneyAccounts.map((account) => ({
                  provider: account.provider,
                  phoneNumber: account.phoneNumber,
                  accountName: account.accountName,
                })),
              }
            : undefined,
        },
      });

      const admin = await tx.adminUser.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          passwordHash: await bcrypt.hash(dto.password, 10),
          role: AdminRole.ADMIN,
          // L'adresse n'est pas confirmee, et cela ne ferme rien : le compte
          // travaille normalement. Bloquer la connexion sur un courriel qui
          // n'arrive pas — SMTP muet, boite pleine, message en indesirables —
          // transformerait un accessoire en panne totale.
          emailCode: code,
          emailCodeSentAt: new Date(),
        },
      });

      return { tenant, admin };
    });

    await this.audit.log({
      tenantId: created.tenant.id,
      action: 'SIGNUP',
      targetType: 'Tenant',
      targetId: created.tenant.id,
      ipAddress,
      payloadDiff: { organizationName: dto.organizationName, currency: dto.currency },
    });

    // Les comptes de la plateforme sont prevenus : une inscription qui
    // n'atteint personne est un client qu'on ne rappellera jamais.
    await this.prevenirLaPlateforme(created.tenant);
    await this.envoyerLeCode(dto.email, code);

    return {
      tenantId: created.tenant.id,
      status: created.tenant.status,
      message: `Compte créé. Votre essai gratuit de ${ESSAI_JOURS} jours commence maintenant : connectez-vous et raccordez votre routeur.`,
      essaiJusquAu: finDEssai.toISOString(),
    };
  }

  /**
   * Envoie le code, depuis le serveur de la plateforme.
   *
   * Jamais celui de l'exploitant : a l'inscription il n'en a pas, et pour un
   * compte d'equipe ce serait lui demander de valider une adresse avec un
   * serveur qu'il vient peut-etre de mal regler.
   */
  private async envoyerLeCode(destinataire: string, code: string): Promise<void> {
    if (!this.courriel) return;
    try {
      await this.envoyerLeCodeOuEchouer(destinataire, code);
    } catch (e) {
      // Trace et oublie, comme l'avis a la plateforme. Un code qui ne part
      // pas ne doit pas emporter l'inscription : le compte existe, l'essai
      // court, et l'adresse se confirmera avec un nouveau code. L'inverse
      // ferait d'un SMTP mal regle une panne totale du produit.
      this.logger.warn(
        `Code de confirmation non parti a ${destinataire} : ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  private async envoyerLeCodeOuEchouer(destinataire: string, code: string): Promise<void> {
    await this.courriel!.envoyerDeLaPlateforme({
      destinataire,
      sujet: `Votre code de confirmation : ${code}`,
      texte:
        `Voici le code qui confirme votre adresse :\n\n    ${code}\n\n` +
        `Saisissez-le dans la console. Il est valable une heure.\n\n` +
        `Sans adresse confirmee, nous ne pourrons pas vous prevenir : ` +
        `echeance d'abonnement, paiement d'un client, panne d'un routeur.\n\n` +
        `Si vous n'etes a l'origine d'aucune inscription, ignorez ce message.\n\n` +
        `— GeMikrot`,
      type: 'confirmation-adresse',
    });
  }

  /**
   * Confirme l'adresse d'un compte a partir du code recu.
   *
   * Le code part des qu'il a servi : un code qui reste valable apres usage
   * n'est plus une preuve, c'est un second mot de passe qui traine.
   */
  async confirmerCourriel(adminUserId: string, code: string): Promise<{ confirme: boolean }> {
    const compte = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });
    if (!compte) throw new UnauthorizedException('Compte introuvable');
    if (compte.emailVerifiedAt) return { confirme: true };

    const perime =
      !compte.emailCodeSentAt ||
      Date.now() - compte.emailCodeSentAt.getTime() > VALIDITE_CODE_MS;
    if (perime) {
      throw new BadRequestException(
        'Ce code a expiré. Demandez-en un nouveau : il est valable une heure.',
      );
    }
    if (!compte.emailCode || compte.emailCode !== code.trim()) {
      throw new BadRequestException('Ce code ne correspond pas.');
    }

    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { emailVerifiedAt: new Date(), emailCode: null, emailCodeSentAt: null },
    });
    await this.audit.log({
      adminUserId,
      tenantId: compte.tenantId ?? undefined,
      action: 'VERIFY_EMAIL',
      targetType: 'AdminUser',
      targetId: adminUserId,
    });
    return { confirme: true };
  }

  /**
   * Renvoie un code, au plus un par minute.
   *
   * La limite protege moins le service que la boite du destinataire : dix
   * codes en dix secondes, et le dixieme part en indesirables avec les neuf
   * autres.
   */
  async renvoyerLeCode(adminUserId: string): Promise<{ envoye: boolean; erreur?: string }> {
    const compte = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });
    if (!compte) throw new UnauthorizedException('Compte introuvable');
    if (compte.emailVerifiedAt) return { envoye: false, erreur: 'Adresse déjà confirmée.' };

    if (compte.emailCodeSentAt && Date.now() - compte.emailCodeSentAt.getTime() < 60_000) {
      throw new BadRequestException(
        'Un code vient de partir. Attendez une minute avant d’en demander un autre.',
      );
    }

    const code = codeDeConfirmation();
    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { emailCode: code, emailCodeSentAt: new Date() },
    });
    await this.envoyerLeCode(compte.email, code);
    return { envoye: true };
  }

  private signToken(admin: { id: string; email: string; role: AdminRole; tenantId: string | null }) {
    return this.jwt.signAsync({
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      tenantId: admin.tenantId,
    });
  }
}
