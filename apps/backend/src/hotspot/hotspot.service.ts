import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { IMikrotikService, IpBindingType } from '@wifitati/mikrotik-service';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { parseRouterTime } from '../routers/router-time.util.js';
import { RouterAccessService } from '../routers/router-access.service.js';
import type {
  CreateHotspotUserDto,
  CreateIpBindingDto,
  CreateWalledGardenDto,
  CreateWalledGardenIpDto,
  UpdateHotspotUserDto,
  UpdateHotspotProfileDto,
} from './dto/hotspot.dto.js';

export interface SessionView {
  id: string;
  username: string;
  startedAt: string | null;
  endedAt: string | null;
  uptimeSeconds: number;
  bytesIn: number;
  bytesOut: number;
  callingStationId: string | null;
  terminateCause: string | null;
  active: boolean;
}

/**
 * Les onglets HotSpot et User Manager que la console ne montrait pas :
 * serveurs et leurs profils, Walled Garden, cookies, et l'historique des
 * sessions comptabilisées par RADIUS.
 *
 * Tout est lu depuis le routeur. L'application n'en garde aucune copie : ces
 * objets appartiennent à la configuration réseau, pas au suivi commercial.
 */
@Injectable()
export class HotspotService {
  private readonly logger = new Logger(HotspotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
    private readonly access: RouterAccessService,
  ) {}

  /**
   * Serveurs et profils, présentés ensemble : c'est le profil qui porte
   * `login-by` et la durée de vie des cookies, donc ce qui détermine si une
   * suspension coupe vraiment l'accès.
   */
  /**
   * Les comptes HotSpot du routeur.
   *
   * Distincts des comptes User Manager : le HotSpot en garde sa propre table,
   * et c'est elle que WinBox montre sous « Users ». Sur ce parc, les 646
   * comptes historiques vivent ici — les tickets vendus depuis sont passes a
   * User Manager, qui seul sait faire expirer une validite calendaire.
   */
  async users(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotUsers();
  }

  /** Les profils HotSpot : debit et duree de session, pas de validite. */
  async profiles(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotProfiles();
  }

  /**
   * Les hotes vus par le HotSpot, authentifies ou non.
   *
   * Un hote sans session est un appareil present sur le reseau qui n'a pas
   * ouvert d'acces : c'est la qu'on repere une TV ou une camera incapable
   * d'afficher un portail captif.
   */
  async hosts(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotHosts();
  }

  /** Les contournements du portail, par adresse MAC. */
  async ipBindings(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getIpBindings();
  }

  /**
   * Faire passer un appareil sans qu'il se connecte, et lui poser une limite.
   *
   * **Les deux ensemble, et c'est le point.** Un appareil contourné ne se
   * connecte jamais : il n'a ni compte, ni profil HotSpot, donc aucune des
   * limites que porte un profil. Sans file d'attente, il prend tout ce qu'il
   * peut — et c'est justement l'appareil qu'on contourne parce qu'il compte :
   * la caisse, la télévision, le téléphone du gérant. Celui dont on
   * remarquerait le moins vite qu'il sature la ligne.
   *
   * La limite est facultative : un appareil de service n'en a pas besoin. Mais
   * elle se pose ici, au même geste, parce que revenir la poser plus tard
   * suppose de savoir qu'elle manque — et rien ne le dit.
   *
   * **La file vise l'adresse, pas la MAC** : `/queue/simple` ne connaît que
   * les adresses. Une limite n'est donc possible que si l'appareil a une
   * adresse fixe — d'où le refus explicite plutôt qu'une file posée sur du
   * vide, qui ne limiterait rien sans que rien ne le signale.
   */
  async creerContournement(
    dto: CreateIpBindingDto & {
      limiteMontanteBps?: number;
      limiteDescendanteBps?: number;
    },
    adminUserId?: string,
    routerId?: string,
  ) {
    const { limiteMontanteBps, limiteDescendanteBps, ...binding } = dto;
    const avecLimite = limiteMontanteBps !== undefined && limiteDescendanteBps !== undefined;
    if (avecLimite && !binding.address) {
      throw new BadRequestException(
        "Une limite de débit exige une adresse fixe pour cet appareil : les files d'attente " +
          'de RouterOS visent une adresse, pas une MAC. Renseignez l’adresse, ou laissez la ' +
          'limite vide.',
      );
    }

    const mikrotik = await this.client(routerId);
    const pose = await mikrotik.createIpBinding(binding);

    let file = null;
    if (avecLimite) {
      // Après le contournement, jamais avant : une file posée sur un
      // contournement qui échoue limiterait un appareil qui, lui, resterait
      // derrière le portail. Personne ne verrait le rapport.
      file = await mikrotik.createSimpleQueue({
        name: `GeMikrot ${binding.macAddress}`,
        target: binding.address!,
        maxLimitUpload: limiteMontanteBps!,
        maxLimitDownload: limiteDescendanteBps!,
        comment: binding.comment ?? 'Contournement GeMikrot',
      });
    }

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'CREATE_IP_BINDING',
      targetType: 'IpBinding',
      targetId: binding.macAddress,
      payloadDiff: {
        type: binding.type,
        address: binding.address ?? null,
        comment: binding.comment ?? null,
        limiteMontanteBps: limiteMontanteBps ?? null,
        limiteDescendanteBps: limiteDescendanteBps ?? null,
      },
    });
    return { binding: pose, file };
  }

  /** Passer un appareil de `regular` à `bypassed`, ou l'inverse. */
  async changerTypeContournement(
    id: string,
    type: IpBindingType,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const binding = await mikrotik.setIpBindingType(id, type);
    await this.audit.log({
      adminUserId,
      routerId,
      action: 'UPDATE_IP_BINDING',
      targetType: 'IpBinding',
      targetId: binding.macAddress || id,
      payloadDiff: { type },
    });
    return binding;
  }

  /**
   * Retirer un contournement, et la file qui l'accompagnait.
   *
   * Sans cela la file survit à l'appareil : elle vise une adresse que le
   * prochain bail DHCP donnera à quelqu'un d'autre, qui héritera d'une limite
   * que personne n'a voulue pour lui.
   */
  async supprimerContournement(id: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const binding = (await mikrotik.getIpBindings()).find((b) => b.id === id);
    if (!binding) throw new NotFoundException(`Contournement ${id} introuvable`);

    await mikrotik.deleteIpBinding(id);

    const file = (await mikrotik.getSimpleQueues()).find(
      (q) => !q.dynamic && q.name === `GeMikrot ${binding.macAddress}`,
    );
    if (file) await mikrotik.deleteSimpleQueue(file.id);

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'DELETE_IP_BINDING',
      targetType: 'IpBinding',
      targetId: binding.macAddress || id,
      payloadDiff: { fileRetiree: file?.name ?? null },
    });
    return { fileRetiree: file?.name ?? null };
  }

  /** Les baux DHCP, pour rapprocher une adresse d'un nom d'appareil. */
  async dhcpLeases(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getDhcpLeases();
  }

  /**
   * Bloque ou reactive un compte HotSpot.
   *
   * Desactiver plutot que supprimer : le compte porte le trafic consomme et,
   * sur ce parc, le nom de la personne dans son commentaire. L'effacer perd
   * les deux.
   *
   * Attention toutefois : desactiver ne coupe pas une session en cours, et un
   * cookie encore valide rouvre l'acces sans repasser par le compte. Pour
   * couper vraiment, passer par `cut-access`, qui purge aussi cookies et
   * session.
   */
  /**
   * Cree un compte HotSpot.
   *
   * A distinguer d'un ticket User Manager : ici la validite n'est pas
   * calendaire. `limitUptimeSeconds` plafonne le temps **passe connecte** et
   * ne s'ecoule pas quand le client se deconnecte — c'est ce que porte le
   * ticket « 2h » du parc, et c'est l'inverse d'un forfait au mois.
   */
  async createUser(dto: CreateHotspotUserDto, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const compte = await mikrotik.createHotspotUser(dto);
    await this.audit.log({
      adminUserId,
      routerId,
      action: 'CREATE_HOTSPOT_USER',
      targetType: 'HotspotUser',
      targetId: dto.username,
      payloadDiff: {
        profile: dto.profileName,
        server: dto.server ?? null,
        limitUptimeSeconds: dto.limitUptimeSeconds ?? null,
      },
    });
    return compte;
  }

  /** N'ecrit que les champs fournis. Le mot de passe ne va pas au journal. */
  async updateUser(
    username: string,
    dto: Omit<UpdateHotspotUserDto, 'username'>,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const compte = await mikrotik.updateHotspotUser({ ...dto, username });
    await this.audit.log({
      adminUserId,
      routerId,
      action: 'UPDATE_HOTSPOT_USER',
      targetType: 'HotspotUser',
      targetId: username,
      payloadDiff: { champs: Object.keys(dto) },
    });
    return compte;
  }

  /**
   * Bloquer suppose trois gestes, pas un.
   *
   * Désactiver le compte ne ferme pas la session en cours, et le profil
   * serveur de ce parc accepte `mac-cookie` avec une durée de vie de **trois
   * jours** : le client se reconnecte sans que le compte désactivé soit
   * consulté. L'écran le disait déjà — mais sur l'onglet Cookies, loin du
   * bouton qui échouait, et derrière une action séparée « Couper l'accès »
   * qu'il fallait penser à aller chercher. **Documenter un piège n'est pas la
   * même chose que ne pas en avoir.**
   */
  async setUserDisabled(
    username: string,
    disabled: boolean,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const compte = await mikrotik.setHotspotUserDisabled(username, disabled);
    // `disableAccount: false` : le compte HotSpot vient d'être désactivé
    // ci-dessus ; `revoke` désactiverait un compte *User Manager*, qui est
    // autre chose.
    const coupure = disabled
      ? await this.access.revoke(mikrotik, username, { disableAccount: false })
      : null;
    await this.audit.log({
      adminUserId,
      routerId,
      action: disabled ? 'DISABLE_HOTSPOT_USER' : 'ENABLE_HOTSPOT_USER',
      targetType: 'HotspotUser',
      targetId: username,
      payloadDiff: coupure ? { ...coupure } : undefined,
    });
    return { ...compte, coupure };
  }

  /**
   * Supprime un compte HotSpot du routeur.
   *
   * Irreversible, et le trafic consomme comme le commentaire disparaissent
   * avec. Le blocage est presque toujours le bon geste ; la suppression sert
   * a nettoyer un compte cree par erreur.
   */
  /**
   * Supprimer suppose de couper d'abord.
   *
   * Effacer le compte ne ferme pas la session en cours et ne touche pas aux
   * cookies : le client reste en ligne, et son `mac-cookie` peut le ramèner.
   * C'est pire que le blocage, qui coupe désormais — une fois le compte
   * disparu, **il n'y a plus de nom à qui rattacher la coupure**, donc plus
   * moyen de rattraper l'oubli depuis cette console.
   *
   * L'ordre compte : couper tant que le compte existe, supprimer ensuite.
   */
  async deleteUser(username: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    await this.access.revoke(mikrotik, username, { disableAccount: false });
    await mikrotik.deleteHotspotUser(username);
    await this.audit.log({
      adminUserId,
      routerId,
      action: 'DELETE_HOTSPOT_USER',
      targetType: 'HotspotUser',
      targetId: username,
    });
  }

  /** Profils de serveur : c'est la que vit `login-by` et la duree des cookies. */
  /**
   * Modifie un profil HotSpot.
   *
   * Ces champs ne sont pas de la décoration : `add-mac-cookie` décide si un
   * client déjà venu revient **sans repasser par RADIUS** — donc si bloquer
   * son compte le coupe tout de suite — et `mac-cookie-timeout` décide
   * combien de temps. Relevé sur ce parc : un ticket de deux heures portait un
   * cookie de dix-huit.
   */
  async updateProfile(
    name: string,
    dto: UpdateHotspotProfileDto,
    adminUserId?: string,
    routerId?: string,
  ) {
    const mikrotik = await this.client(routerId);
    const profil = await mikrotik.updateHotspotProfile({ name, ...dto });
    await this.audit.log({
      adminUserId,
      routerId,
      action: 'UPDATE_HOTSPOT_PROFILE',
      targetType: 'HotspotProfile',
      targetId: name,
      payloadDiff: { champs: Object.keys(dto) },
    });
    return profil;
  }

  async serverProfiles(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotServerProfiles();
  }

  /** Protocoles dont le HotSpot suit les connexions (`ftp`, `sip`...). */
  async servicePorts(routerId?: string) {
    const mikrotik = await this.client(routerId);
    return mikrotik.getHotspotServicePorts();
  }

  async overview(routerId?: string) {
    const mikrotik = await this.client(routerId);
    const [servers, profiles, cookies, active] = await Promise.all([
      mikrotik.getHotspotServers(),
      mikrotik.getHotspotServerProfiles(),
      mikrotik.getHotspotCookies(),
      mikrotik.getHotspotActiveUsers(),
    ]);

    const profileByName = new Map(profiles.map((profile) => [profile.name, profile]));
    return {
      servers: servers.map((server) => ({
        ...server,
        profile: server.profileName ? (profileByName.get(server.profileName) ?? null) : null,
      })),
      profiles,
      cookieCount: cookies.length,
      activeSessionCount: active.length,
      /**
       * Nombre de sessions entrées sans passer par RADIUS. Ce sont celles
       * qu'une suspension côté User Manager n'aurait pas coupées.
       */
      sessionsWithoutRadius: active.filter((session) => session.loginBy.includes('cookie')).length,
    };
  }

  // ---------- Walled Garden ----------

  async getWalledGarden(routerId?: string) {
    const mikrotik = await this.client(routerId);
    const [hosts, ips] = await Promise.all([
      mikrotik.getWalledGarden(),
      mikrotik.getWalledGardenIps(),
    ]);
    return { hosts, ips };
  }

  async addWalledGardenHost(dto: CreateWalledGardenDto, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const entry = await mikrotik.createWalledGardenEntry(dto);
    await this.log(adminUserId, 'CREATE_WALLED_GARDEN', entry.id, { dstHost: dto.dstHost });
    return entry;
  }

  async removeWalledGardenHost(id: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    await mikrotik.deleteWalledGardenEntry(id);
    await this.log(adminUserId, 'DELETE_WALLED_GARDEN', id);
  }

  async addWalledGardenIp(dto: CreateWalledGardenIpDto, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const entry = await mikrotik.createWalledGardenIpEntry(dto);
    await this.log(adminUserId, 'CREATE_WALLED_GARDEN_IP', entry.id, {
      dstAddress: dto.dstAddress,
    });
    return entry;
  }

  async removeWalledGardenIp(id: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    await mikrotik.deleteWalledGardenIpEntry(id);
    await this.log(adminUserId, 'DELETE_WALLED_GARDEN_IP', id);
  }

  // ---------- Cookies ----------

  /**
   * Les cookies de connexion, avec le temps qu'il leur reste. Un cookie
   * vivant rouvre une session sans repasser par RADIUS : c'est ce qui laisse
   * un accès coupé fonctionner encore, parfois plusieurs jours.
   */
  /**
   * Le stock de tickets réellement posé sur le routeur.
   *
   * La console ne suit que ce qu'elle a créé elle-même, et la Vue d'ensemble
   * présentait ce compte-là sous le titre « ce qui reste à vendre ». Relevé sur
   * ce parc : **10 annoncés, 602 en stock**. L'exploitant lisait le soixantième
   * de son propre tiroir.
   *
   * Un compte jamais connecté — `uptime` à zéro — est un ticket qui n'a pas
   * servi. Ce n'est pas la même chose qu'un ticket « à vendre » en base : un
   * ticket imprimé et perdu compte ici et pas là. Les deux nombres sont donc
   * rendus **séparément**, jamais additionnés.
   */
  /**
   * Les comptes vendables qu'aucun plafond de durée n'arrête.
   *
   * Sans `limit-uptime`, un ticket HotSpot ne finit jamais. Le
   * `session-timeout` du profil coupe la session en cours, mais **repart à
   * zéro à chaque reconnexion**, et le cookie rend cette reconnexion
   * automatique : un « 2 heures » se rejoue indéfiniment. Relevé sur le parc :
   * 228 comptes dans ce cas, aucun plafond d'octets non plus.
   *
   * `appliquer` à faux ne touche à rien et rend ce qui changerait. C'est le
   * mode par défaut : poser un plafond sur des comptes vendables se regarde
   * avant de se faire.
   */
  async plafonds(
    routerId: string | undefined,
    options: { appliquer?: boolean } = {},
  ): Promise<{
    appliqué: boolean;
    aCorriger: { username: string; profil: string; plafondSecondes: number }[];
    ignorés: { username: string; profil: string; motif: string }[];
    corrigés: number;
    échecs: { username: string; motif: string }[];
  }> {
    const mikrotik = await this.client(routerId);
    const [comptes, profils, offresTicket] = await Promise.all([
      mikrotik.getHotspotUsers(),
      mikrotik.getHotspotProfiles(),
      // Seules les offres à la carte. Un abonnement au mois se compte en
      // CALENDRIER, pas en heures de connexion : lui poser un `limit-uptime`
      // le couperait au bout de trente jours *passés en ligne*, ce qui n'a
      // aucun rapport avec ce qu'il a acheté. Le profil ne suffit pas à les
      // distinguer — `1Mois-15000Ar` porte `session-timeout=4w2d` comme un
      // ticket porte `2h` — mais la console, elle, sait lequel est lequel.
      this.prisma.scopedStrict.plan.findMany({
        where: { kind: 'TICKET' },
        select: { mikrotikProfileName: true },
      }),
    ]);
    const durée = new Map(profils.map((p) => [p.name, p.sessionTimeoutSeconds]));
    const profilsTicket = new Set(
      offresTicket
        .map((o) => o.mikrotikProfileName)
        .filter((n): n is string => Boolean(n))
        .map((n) => n.toLowerCase()),
    );

    const aCorriger: { username: string; profil: string; plafondSecondes: number }[] = [];
    const ignorés: { username: string; profil: string; motif: string }[] = [];

    for (const compte of comptes) {
      if (compte.limitUptimeSeconds != null) continue;
      const profil = compte.profile || '';
      const plafond = durée.get(profil) ?? null;

      // La garde qui compte : hors d'une offre à la carte, on ne touche à rien.
      // Les comptes d'administration comme les abonnés au mois tombent ici.
      if (!profilsTicket.has(profil.toLowerCase())) {
        ignorés.push({
          username: compte.username,
          profil,
          motif: "pas une offre à la carte",
        });
        continue;
      }
      if (!plafond) {
        ignorés.push({ username: compte.username, profil, motif: 'profil sans durée' });
        continue;
      }
      // Déjà entamé : poser le plafond maintenant raccourcirait ce que le
      // client a déjà, et pourrait le couper en pleine session. C'est à
      // l'exploitant de trancher au cas par cas, pas à un traitement de masse.
      if (compte.uptimeSeconds > 0) {
        ignorés.push({ username: compte.username, profil, motif: 'déjà utilisé' });
        continue;
      }
      if (compte.disabled) {
        ignorés.push({ username: compte.username, profil, motif: 'bloqué' });
        continue;
      }
      aCorriger.push({ username: compte.username, profil, plafondSecondes: plafond });
    }

    if (!options.appliquer) {
      return { appliqué: false, aCorriger, ignorés, corrigés: 0, échecs: [] };
    }

    let corrigés = 0;
    const échecs: { username: string; motif: string }[] = [];
    for (const cible of aCorriger) {
      try {
        await mikrotik.updateHotspotUser({
          username: cible.username,
          limitUptimeSeconds: cible.plafondSecondes,
        });
        corrigés += 1;
      } catch (error) {
        // Un compte en échec n'arrête pas les autres : mieux vaut 227 plafonds
        // posés et un échec nommé que rien du tout.
        échecs.push({
          username: cible.username,
          motif: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log(
      `Plafonds de durée : ${corrigés} posé(s), ${échecs.length} en échec, ${ignorés.length} ignoré(s)`,
    );
    return { appliqué: true, aCorriger, ignorés, corrigés, échecs };
  }

  async stock(routerId?: string): Promise<{
    total: number;
    jamaisUtilises: number;
    parProfil: { profil: string; nombre: number }[];
  }> {
    const mikrotik = await this.client(routerId);
    const comptes = await mikrotik.getHotspotUsers();
    const neufs = comptes.filter((u) => !u.disabled && u.uptimeSeconds === 0);

    const parProfil = new Map<string, number>();
    for (const compte of neufs) {
      const profil = compte.profile || '(sans profil)';
      parProfil.set(profil, (parProfil.get(profil) ?? 0) + 1);
    }

    return {
      total: comptes.length,
      jamaisUtilises: neufs.length,
      parProfil: [...parProfil]
        .map(([profil, nombre]) => ({ profil, nombre }))
        .sort((a, b) => b.nombre - a.nombre),
    };
  }

  /**
   * Les cookies, avec l'état du compte derrière chacun.
   *
   * La liste brute est inexploitable : sur ce parc elle compte une
   * cinquantaine de lignes, et ce qui mérite un geste s'y perd. Le croisé
   * avec les comptes a trouvé, du premier coup, **un cookie dont le compte
   * n'existe plus** et **sept cookies de comptes délibérément bloqués** — les
   * seconds étant les victimes du défaut corrigé le même jour, où bloquer un
   * compte laissait ses cookies en place.
   *
   * Que RouterOS honore ou non le cookie d'un compte désactivé n'est **pas
   * éprouvé ici** — il faudrait un appareil client pour le savoir. Mais un
   * reliquat qu'on ne peut ni voir ni effacer est un doute permanent, et
   * l'effacer ne coûte rien à personne : le client en règle retape son code.
   *
   * Trois lectures au lieu d'une, sur un onglet qu'on ouvre exprès.
   */
  async getCookies(routerId?: string) {
    const mikrotik = await this.client(routerId);
    const [cookies, hotspotUsers, umUsers] = await Promise.all([
      mikrotik.getHotspotCookies(),
      mikrotik.getHotspotUsers(),
      mikrotik.getUserManagerUsers(),
    ]);

    const actifs = new Set<string>();
    const bloqués = new Set<string>();
    for (const compte of [...hotspotUsers, ...umUsers]) {
      (compte.disabled ? bloqués : actifs).add(compte.username);
    }

    return cookies.map((cookie) => ({
      ...cookie,
      // Un compte actif l'emporte sur un homonyme bloqué : le même nom peut
      // exister des deux côtés, HotSpot et User Manager.
      etatDuCompte: actifs.has(cookie.username)
        ? ('actif' as const)
        : bloqués.has(cookie.username)
          ? ('bloque' as const)
          : ('absent' as const),
    }));
  }

  async deleteCookie(id: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    await mikrotik.deleteHotspotCookie(id);
    await this.log(adminUserId, 'DELETE_HOTSPOT_COOKIE', id);
  }

  /** Purge les cookies d'un compte et ferme sa session : coupure immédiate. */
  async cutAccess(username: string, adminUserId?: string, routerId?: string) {
    const mikrotik = await this.client(routerId);
    const result = await this.access.revoke(mikrotik, username, { disableAccount: false });
    await this.log(adminUserId, 'CUT_HOTSPOT_ACCESS', username, { ...result });
    return result;
  }

  // ---------- Sessions User Manager ----------

  /**
   * Historique comptabilisé par RADIUS : qui s'est connecté, combien de
   * temps, combien de données. C'est la seule source qui dit ce qu'un compte
   * a réellement consommé.
   */
  async getSessions(username?: string, routerId?: string): Promise<SessionView[]> {
    const mikrotik = await this.client(routerId);
    const [sessions, clock] = await Promise.all([
      mikrotik.getUserManagerSessions(username),
      mikrotik.getClock(),
    ]);

    return sessions
      .map((session) => ({
        id: session.id,
        username: session.username,
        startedAt: parseRouterTime(session.startTime, clock.gmtOffset)?.toISOString() ?? null,
        endedAt: parseRouterTime(session.stopTime, clock.gmtOffset)?.toISOString() ?? null,
        uptimeSeconds: session.sessionTimeSeconds,
        bytesIn: session.bytesIn,
        bytesOut: session.bytesOut,
        callingStationId: session.callingStationId,
        terminateCause: session.terminateCause,
        // L'état vient du routeur : une session close dont la date de fin
        // manque ne doit pas passer pour encore en cours.
        active: session.active,
      }))
      .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  }

  /** Le routeur est résolu par le client cloisonné, jamais par l'URL seule. */
  private async client(routerId?: string): Promise<IMikrotikService> {
    if (!routerId) return this.clients.forDefaultRouter();

    const router = await this.prisma.scopedStrict.router.findUnique({ where: { id: routerId } });
    if (!router) throw new NotFoundException(`Routeur ${routerId} introuvable`);
    return this.clients.forRouter(router.id);
  }

  private log(
    adminUserId: string | undefined,
    action: string,
    targetId: string,
    payloadDiff?: Record<string, unknown>,
  ) {
    return this.audit.log({
      adminUserId,
      action,
      targetType: 'Hotspot',
      targetId,
      payloadDiff: payloadDiff as never,
    });
  }
}
