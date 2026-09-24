import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createTransport } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * L'envoi de courriel, et la trace de ce qui est parti.
 *
 * **Un SMTP par exploitant.** Le message part de son adresse, à sa marque : un
 * compte unique de plateforme ferait écrire à ses clients depuis une adresse
 * qui n'est pas la sienne, et une réputation abîmée par un seul les
 * toucherait tous.
 *
 * **Rien ne part tant que l'exploitant n'a pas dit oui.** `smtpActif` est faux
 * par défaut : enregistrer une configuration ne doit pas suffire à déclencher
 * des messages vers des clients. C'est un interrupteur, pas une conséquence.
 *
 * **Chaque tentative laisse une ligne, réussie ou non.** Un envoi qui échoue
 * en silence est pire que pas d'envoi : l'exploitant croit avoir prévenu, le
 * client n'a rien reçu, et personne ne le saura. Le journal est donc écrit
 * avant de rendre la main, et un échec n'interrompt jamais ce qui l'a
 * déclenché — un paiement se vérifie même si le courriel de confirmation ne
 * part pas.
 */

const ALGORITHME = 'aes-256-gcm';
const LONGUEUR_IV = 12;

/** Ce qu'un exploitant règle. Le mot de passe n'en sort jamais. */
export interface ReglagesCourriel {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  actif: boolean;
  /** Vrai quand un mot de passe est enregistré. Sa valeur ne sort pas. */
  motDePassePose: boolean;
}

/** Ce que la plateforme regle pour elle-meme. */
export interface ReglagesPlateforme extends ReglagesCourriel {
  nom: string;
  contactTelephone: string;
  contactWhatsapp: string;
  contactCourriel: string;
}

/** Il n'y a qu'une plateforme : sa ligne porte toujours cette clef. */
export const ID_PLATEFORME = 'plateforme';

export interface ResultatEnvoi {
  envoye: boolean;
  erreur?: string;
}

@Injectable()
export class CourrielService {
  private readonly logger = new Logger(CourrielService.name);
  private readonly cle: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    // La même clef que les identifiants routeur, et c'est assumé : même
    // frontière de confiance, même sauvegarde à part. La perdre rend les deux
    // illisibles — c'est déjà écrit dans le plan de reprise.
    const brute = config.getOrThrow<string>('ROUTER_CREDENTIALS_KEY');
    this.cle = Buffer.from(brute, 'hex');
  }

  private chiffrer(texte: string): string {
    const iv = randomBytes(LONGUEUR_IV);
    const cipher = createCipheriv(ALGORITHME, this.cle, iv);
    const chiffre = Buffer.concat([cipher.update(texte, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), chiffre].map((p) => p.toString('base64url')).join('.');
  }

  private dechiffrer(charge: string): string {
    const [ivPart, tagPart, dataPart] = charge.split('.');
    if (!ivPart || !tagPart || !dataPart) {
      throw new Error('Mot de passe SMTP illisible : format chiffré invalide');
    }
    const decipher = createDecipheriv(ALGORITHME, this.cle, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  async reglages(): Promise<ReglagesCourriel> {
    const tenantId = this.tenantContext.requireTenantId();
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpFrom: true,
        smtpActif: true,
        smtpPasswordEncrypted: true,
      },
    });
    return {
      host: t?.smtpHost ?? '',
      port: t?.smtpPort ?? 587,
      secure: t?.smtpSecure ?? false,
      user: t?.smtpUser ?? '',
      from: t?.smtpFrom ?? '',
      actif: t?.smtpActif ?? false,
      // Le mot de passe ne revient jamais au navigateur : on dit seulement
      // qu'il y en a un, ce qui suffit à savoir s'il faut le ressaisir.
      motDePassePose: Boolean(t?.smtpPasswordEncrypted),
    };
  }

  async enregistrer(
    dto: Partial<ReglagesCourriel> & { motDePasse?: string },
    adminUserId: string,
  ): Promise<ReglagesCourriel> {
    const tenantId = this.tenantContext.requireTenantId();

    if (dto.from && !/^[^<>]*<?[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>?$/.test(dto.from.trim())) {
      throw new BadRequestException(
        "L'expéditeur doit contenir une adresse valide, par exemple « Zone WIFI-TATI <contact@wifitati.net> ».",
      );
    }

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        smtpHost: dto.host?.trim() || null,
        smtpPort: dto.port ?? null,
        smtpSecure: dto.secure ?? false,
        smtpUser: dto.user?.trim() || null,
        smtpFrom: dto.from?.trim() || null,
        smtpActif: dto.actif ?? false,
        // Un champ laissé vide **ne remplace pas** le mot de passe enregistré :
        // l'écran ne le renvoie jamais, donc le traiter comme un effacement
        // le perdrait à chaque enregistrement du reste.
        ...(dto.motDePasse ? { smtpPasswordEncrypted: this.chiffrer(dto.motDePasse) } : {}),
      },
    });

    await this.audit.log({
      adminUserId,
      action: 'SET_SMTP',
      targetType: 'Tenant',
      targetId: tenantId,
      // Ni le mot de passe ni son chiffré : un journal se lit à plusieurs.
      payloadDiff: { host: dto.host ?? null, actif: dto.actif ?? false },
    });

    return this.reglages();
  }

  /**
   * Envoie, et laisse une trace quoi qu'il arrive.
   *
   * Ne lève jamais : un courriel est un accessoire, et le faire échouer
   * emporterait le geste qui l'a déclenché — un paiement vérifié qu'on annule
   * parce que la confirmation n'est pas partie serait absurde.
   */
  async envoyer(input: {
    destinataire: string;
    sujet: string;
    texte: string;
    type: string;
    tenantId?: string;
  }): Promise<ResultatEnvoi> {
    const tenantId = input.tenantId ?? this.tenantContext.requireTenantId();
    const t = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUser: true,
        smtpFrom: true,
        smtpActif: true,
        smtpPasswordEncrypted: true,
      },
    });

    const manque = !t?.smtpActif
      ? "L'envoi de courriel n'est pas activé"
      : !t.smtpHost || !t.smtpFrom
        ? 'Serveur ou expéditeur non renseigné'
        : null;
    if (manque) return this.tracer(tenantId, input, 'ECHEC', manque);

    try {
      const transport = createTransport({
        host: t!.smtpHost!,
        port: t!.smtpPort ?? 587,
        secure: t!.smtpSecure,
        auth: t!.smtpUser
          ? {
              user: t!.smtpUser,
              pass: t!.smtpPasswordEncrypted ? this.dechiffrer(t!.smtpPasswordEncrypted) : '',
            }
          : undefined,
      });
      await transport.sendMail({
        from: t!.smtpFrom!,
        to: input.destinataire,
        subject: input.sujet,
        text: input.texte,
      });
      return this.tracer(tenantId, input, 'ENVOYE', null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Envoi refusé';
      this.logger.warn(`Courriel non parti à ${input.destinataire} : ${message}`);
      return this.tracer(tenantId, input, 'ECHEC', message);
    }
  }

  /**
   * Un message de la plateforme, et non d'un exploitant.
   *
   * Avis d'inscription, code de confirmation : ces messages ne sont ceux
   * d'aucun exploitant. Ils partaient auparavant du SMTP du nouvel inscrit
   * — qui n'en a aucun a la seconde ou il s'inscrit — donc **ils ne
   * partaient jamais**. Ils ont desormais leur propre serveur.
   *
   * Ne leve jamais, comme l'autre : un code de confirmation qui ne part pas
   * ne doit pas empecher l'inscription. L'adresse se confirmera plus tard,
   * et l'echec est au journal avec sa raison.
   */
  async envoyerDeLaPlateforme(input: {
    destinataire: string;
    sujet: string;
    texte: string;
    type: string;
  }): Promise<ResultatEnvoi> {
    const p = await this.prisma.plateforme.findUnique({ where: { id: ID_PLATEFORME } });

    const manque = !p?.smtpActif
      ? "L'envoi de courriel de la plateforme n'est pas activé"
      : !p.smtpHost || !p.smtpFrom
        ? 'Serveur ou expéditeur de la plateforme non renseigné'
        : null;
    if (manque) return this.tracer(null, input, 'ECHEC', manque);

    try {
      await this.transport({
        host: p!.smtpHost!,
        port: p!.smtpPort ?? 587,
        secure: p!.smtpSecure,
        user: p!.smtpUser,
        motDePasseChiffre: p!.smtpPasswordEncrypted,
      }).sendMail({
        from: p!.smtpFrom!,
        to: input.destinataire,
        subject: input.sujet,
        text: input.texte,
      });
      return this.tracer(null, input, 'ENVOYE', null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Envoi refusé';
      this.logger.warn(`Courriel de plateforme non parti à ${input.destinataire} : ${message}`);
      return this.tracer(null, input, 'ECHEC', message);
    }
  }

  /**
   * La plateforme sait-elle ecrire ?
   *
   * La question n'est pas rhetorique : tant que la reponse est non, **aucun
   * code de confirmation ne peut arriver**, et un ecran qui reclame ce code
   * enferme celui qui le lit. Il n'a rien fait de travers, il n'a aucun
   * moyen de s'en sortir, et rien ne le lui dit.
   *
   * Les memes trois conditions que l'envoi lui-meme, et pas seulement
   * `smtpActif` : un interrupteur allume sur une configuration vide n'envoie
   * pas davantage qu'un interrupteur eteint.
   */
  async plateformePeutEcrire(): Promise<boolean> {
    const p = await this.prisma.plateforme.findUnique({ where: { id: ID_PLATEFORME } });
    return Boolean(p?.smtpActif && p.smtpHost && p.smtpFrom);
  }

  /** Ce que la plateforme a regle, mot de passe exclu. */
  async reglagesPlateforme(): Promise<ReglagesPlateforme> {
    const p = await this.prisma.plateforme.findUnique({ where: { id: ID_PLATEFORME } });
    return {
      nom: p?.nom ?? 'GeMikrot',
      host: p?.smtpHost ?? '',
      port: p?.smtpPort ?? 587,
      secure: p?.smtpSecure ?? false,
      user: p?.smtpUser ?? '',
      from: p?.smtpFrom ?? '',
      actif: p?.smtpActif ?? false,
      motDePassePose: Boolean(p?.smtpPasswordEncrypted),
      contactTelephone: p?.contactTelephone ?? '',
      contactWhatsapp: p?.contactWhatsapp ?? '',
      contactCourriel: p?.contactCourriel ?? '',
    };
  }

  /**
   * Enregistre les reglages de la plateforme.
   *
   * `actif` est separe du reste et **faux par defaut** : enregistrer une
   * configuration ne doit pas suffire a se mettre a ecrire a des gens.
   */
  async enregistrerPlateforme(
    dto: Partial<ReglagesPlateforme> & { motDePasse?: string },
    adminUserId: string,
  ): Promise<ReglagesPlateforme> {
    const donnees = {
      nom: dto.nom?.trim() || 'GeMikrot',
      smtpHost: dto.host?.trim() || null,
      smtpPort: dto.port ?? 587,
      smtpSecure: dto.secure ?? false,
      smtpUser: dto.user?.trim() || null,
      smtpFrom: dto.from?.trim() || null,
      smtpActif: dto.actif ?? false,
      contactTelephone: dto.contactTelephone?.trim() || null,
      contactWhatsapp: dto.contactWhatsapp?.trim() || null,
      contactCourriel: dto.contactCourriel?.trim() || null,
      // Le mot de passe n'est reecrit que s'il est fourni : un formulaire
      // renvoye sans lui ne doit pas effacer celui qui marche.
      ...(dto.motDePasse ? { smtpPasswordEncrypted: this.chiffrer(dto.motDePasse) } : {}),
    };

    await this.prisma.plateforme.upsert({
      where: { id: ID_PLATEFORME },
      update: donnees,
      create: { id: ID_PLATEFORME, ...donnees },
    });

    await this.audit.log({
      adminUserId,
      action: 'SET_PLATFORM_SMTP',
      targetType: 'Plateforme',
      targetId: ID_PLATEFORME,
      // Jamais le mot de passe : savoir qu'il a change suffit.
      payloadDiff: { host: donnees.smtpHost, from: donnees.smtpFrom, actif: donnees.smtpActif },
    });
    return this.reglagesPlateforme();
  }

  /** Le journal de la plateforme : ses propres envois, pas ceux d'un exploitant. */
  journalPlateforme() {
    return this.prisma.courriel.findMany({
      where: { tenantId: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Un transport nodemailer, monte a la demande et jamais garde. */
  private transport(c: {
    host: string;
    port: number;
    secure: boolean;
    user: string | null;
    motDePasseChiffre: string | null;
  }) {
    return createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: c.user
        ? { user: c.user, pass: c.motDePasseChiffre ? this.dechiffrer(c.motDePasseChiffre) : '' }
        : undefined,
    });
  }

  private async tracer(
    tenantId: string | null,
    input: { destinataire: string; sujet: string; type: string },
    statut: 'ENVOYE' | 'ECHEC',
    erreur: string | null,
  ): Promise<ResultatEnvoi> {
    await this.prisma.courriel.create({
      data: {
        tenantId,
        destinataire: input.destinataire,
        sujet: input.sujet,
        type: input.type,
        statut,
        erreur,
      },
    });
    return statut === 'ENVOYE' ? { envoye: true } : { envoye: false, erreur: erreur ?? undefined };
  }

  /** Les cinquante derniers, du plus récent au plus ancien. */
  journal() {
    return this.prisma.scoped.courriel.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
