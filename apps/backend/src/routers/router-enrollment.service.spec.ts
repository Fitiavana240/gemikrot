import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
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

      // Le script ne restreint PAS l'accès à l'API. Le faire avant d'avoir
      // éprouvé le tunnel a coupé un routeur en essai : « set www-ssl
      // address=... » remplace la liste, et la forme censée y ajouter une
      // entrée l'a effacée. Le resserrage est une étape séparée.
      expect(invitation.script).not.toContain('/ip/service/set');

      // Et aucune variable ne traverse deux lignes : collées une par une dans
      // le terminal, elles ne se voient pas, et la valeur partirait vide.
      expect(invitation.script.split(/\r?\n/).some((l) => l.startsWith(':local'))).toBe(false);
      expect(invitation.script).toContain(
        '[/interface/wireguard/get [find name=gemikrot] public-key]',
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

      // **Le pair du serveur n'a pas de point d'appel, et c'est le coeur du
      // montage : c'est le serveur qui appelle ce routeur.**
      //
      // Le sens inverse etait le premier choix, et il reste le bon quand le
      // serveur a une adresse publique fixe. Il s'effondre des que le serveur
      // est mobile : un portable en partage de connexion recoit une adresse
      // privee de son operateur, et personne ne peut l'appeler.
      expect(invitation.script).not.toContain('endpoint-address=');
      // Ni battement : on ne maintient pas ouverte une conversation avec
      // quelqu'un dont on ignore l'adresse. C'est au serveur de le faire.
      // Le signe egal compte : le script *parle* de ce reglage dans son
      // commentaire, pour dire pourquoi il ne le pose pas.
      expect(invitation.script).not.toContain('persistent-keepalive=');
    });

    it('ouvre le port du tunnel en entree, en tete de chaine', async () => {
      // Le pare-feu par defaut de RouterOS refuse toute connexion entrante
      // non sollicitee : le tunnel resterait muet, sans un mot, et l'on
      // chercherait du cote des cles. Posee en queue, la regle serait
      // precedee du refus general et ne servirait a rien.
      const script = (await asA(() => service.invite('Routeur ouvert'))).script;

      expect(script).toContain('chain=input protocol=udp dst-port=13231');
      expect(script).toContain('place-before=0');
      // Rejouable, comme le reste.
      expect(script).toMatch(/:do \{ \/ip\/firewall\/filter\/remove .* \} on-error=\{\}/);
    });

    it('demande a MikroTik un nom stable, et le rapporte', async () => {
      // L'adresse publique du routeur est attribuee par son fournisseur et
      // change sans prevenir -- celle de ce parc a change en une nuit, et le
      // tunnel a silencieusement cesse de fonctionner.
      const script = (await asA(() => service.invite('Routeur nomme'))).script;

      expect(script).toContain('/ip/cloud set ddns-enabled=yes');
      expect(script).toContain('/ip/cloud/get dns-name');
      expect(script).toContain('\\"endpoint\\":');
      // `:global` et non `:local` : collees une par une dans le terminal, deux
      // lignes ne partagent pas leurs variables locales.
      expect(script).toContain(':global gmNom');
      expect(script.split(/\r?\n/).some((l) => l.startsWith(':local'))).toBe(false);
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

      // Rejouer le script ne doit pas créer un second routeur. **410 et non
      // 404** : le jeton a existé, il a servi. `/tool/fetch` n'affiche que le
      // code, et « 404 Not Found » envoyait chercher une faute de frappe dans
      // une adresse qui était juste.
      await expect(service.consume(token, { publicKey: routerKey('b') })).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('refuse un jeton expiré', async () => {
      const invitation = await asA(() => service.invite('Routeur périmé'));
      const token = invitation.script.match(/callback\/([A-Za-z0-9_-]+)"/)![1];
      await prisma.routerEnrollment.update({
        where: { id: invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // Périmé, donc **410 Gone**, avec de quoi agir : le tunnel et le compte
      // sont posés sur le routeur, il ne manque que l'avis au serveur.
      await expect(service.consume(token, { publicKey: routerKey('c') })).rejects.toThrow(
        GoneException,
      );
      await expect(service.consume(token, { publicKey: routerKey('c') })).rejects.toThrow(
        /Préparez-en un nouveau/,
      );
    });

    it('refuse un jeton inventé, sans rien dire de plus', async () => {
      // Inconnu : 404, et rien de plus. Distinguer « périmé » de « inconnu »
      // ne donne rien à qui tâtonne — savoir qu'un jeton a expiré suppose de
      // l'avoir eu — mais épargne un faux diagnostic à qui l'avait.
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


  /**
   * Le certificat que le script pose.
   *
   * Le premier essai repondait << failure: CA not found >> sur un routeur reel :
   * un certificat de serveur ne porte pas `key-cert-sign`, il ne peut donc pas
   * se signer lui-meme, et RouterOS cherche alors une autorite qui n'existe pas.
   * Ces epreuves fixent la forme qui marche.
   */
  describe('le certificat dans le script', () => {
    it('pose une autorite avant le certificat de service', async () => {
      const invitation = await asA(() => service.invite('Routeur certificat'));
      const script = invitation.script;

      const poseCa = script.indexOf('add name="gemikrot-ca"');
      const signeCa = script.indexOf('sign "gemikrot-ca"');
      const poseCert = script.indexOf('add name="gemikrot-api-cert"');
      const signeCert = script.indexOf('sign "gemikrot-api-cert" ca="gemikrot-ca"');

      expect(poseCa).toBeGreaterThan(-1);
      expect(signeCa).toBeGreaterThan(poseCa);
      expect(poseCert).toBeGreaterThan(signeCa);
      expect(signeCert).toBeGreaterThan(poseCert);
    });

    it('donne a l\u2019autorite le droit de signer, et pas au certificat de service', async () => {
      // C'est toute la raison d'etre des deux : `key-cert-sign` est ce qui
      // permet de signer, et un certificat de serveur ne doit pas l'avoir.
      const script = (await asA(() => service.invite('Routeur droits'))).script;

      expect(script).toMatch(/name="gemikrot-ca"[\s\S]*?key-usage=key-cert-sign,crl-sign/);
      expect(script).toMatch(
        /name="gemikrot-api-cert"[\s\S]*?key-usage=digital-signature,key-encipherment,tls-server/,
      );
    });

    it('retire le certificat de service avant son autorite', async () => {
      // RouterOS refuse de retirer une autorite dont un certificat depend.
      const script = (await asA(() => service.invite('Routeur nettoyage'))).script;

      const retireCert = script.indexOf('remove [find name="gemikrot-api-cert"]');
      const retireCa = script.indexOf('remove [find name="gemikrot-ca"]');

      expect(retireCert).toBeGreaterThan(-1);
      expect(retireCa).toBeGreaterThan(retireCert);
    });

    it('rattache le certificat au service et l\u2019active', async () => {
      const script = (await asA(() => service.invite('Routeur service'))).script;

      expect(script).toMatch(
        /\/ip\/service set www-ssl certificate="gemikrot-api-cert" disabled=no/,
      );
      /**
       * Sans restreindre l'adresse : cette forme a déjà coupé un routeur en
       * essai. On regarde les **commandes**, pas les commentaires — le script
       * explique justement pourquoi il ne le fait pas, et cette explication
       * ne doit pas faire échouer l'épreuve.
       */
      const commandes = script.split('\n').filter((l) => !l.trimStart().startsWith('#'));
      expect(commandes.filter((l) => l.includes('www-ssl') && l.includes('address='))).toEqual([]);
    });

      it('enferme les signatures dans un bloc que le collage ne peut pas interrompre', async () => {
      /**
       * Le defaut qui a coute une soiree : `/certificate sign` s'execute en
       * arriere-plan et **toute frappe pendant son travail l'interrompt**. La
       * ligne collee derriere lui est avalee — parfois a moitie, ce qui donne
       * un « bad command name » sur un fragment de commentaire — et les
       * commandes suivantes disparaissent sans laisser de trace.
       *
       * Entre accolades, le terminal n'execute rien avant l'accolade
       * fermante : il accumule, et le collage ne peut rien interrompre.
       */
      const script = (await asA(() => service.invite('Routeur bloc'))).script;

      const ouverture = script.indexOf(':execute script={');
      const fermeture = script.indexOf('\n}', ouverture);
      expect(ouverture).toBeGreaterThan(-1);
      expect(fermeture).toBeGreaterThan(ouverture);

      // Les quatre gestes du certificat vivent tous dans le bloc.
      const bloc = script.slice(ouverture, fermeture);
      for (const geste of [
        'remove [find name="gemikrot-api-cert"]',
        'add name="gemikrot-ca"',
        'sign "gemikrot-ca"',
        'sign "gemikrot-api-cert" ca="gemikrot-ca"',
        'set www-ssl certificate="gemikrot-api-cert"',
      ]) {
        expect(bloc).toContain(geste);
      }
    });

    it('laisse aux signatures le temps de finir avant de s’en servir', async () => {
      // Sans attente, le certificat de service serait cree avant que son
      // autorite existe, et le service recevrait un nom qui ne designe rien.
      const script = (await asA(() => service.invite('Routeur delai'))).script;

      expect(script).toMatch(/sign "gemikrot-ca";[\s\S]*?:delay \d+s;/);
      expect(script).toMatch(/sign "gemikrot-api-cert"[^;]*;[\s\S]*?:delay \d+s;/);
    });

    it('laisse une trace dans le journal du routeur', async () => {
      // Le bloc tourne en arriere-plan : sans cette ligne, son resultat
      // n'apparait nulle part et l'on ne sait pas s'il a abouti.
      const script = (await asA(() => service.invite('Routeur journal'))).script;

      expect(script).toMatch(/:log info "GeMikrot/);
    });

    it('met chaque retrait a l’abri de l’echec et du collage', async () => {
      /**
       * `:do { ... } on-error={}` fait deux choses a la fois : il avale
       * l'echec quand il n'y a rien a retirer — sur un routeur vierge, c'est
       * le cas de tous — et il met la commande entre accolades, ou le
       * terminal n'execute rien avant l'accolade fermante. Un collage ne peut
       * donc pas l'interrompre a mi-chemin.
       *
       * Idiome repris du script d'un autre produit, ou il sert exactement a
       * cela. Le notre rendait un mur de « failure: no such item » au premier
       * passage.
       */
      const script = (await asA(() => service.invite('Routeur retraits'))).script;

      const retraits = script
        .split('\n')
        .filter((l) => l.includes('/remove ') && !l.trimStart().startsWith('#'));

      expect(retraits.length).toBeGreaterThan(3);
      for (const ligne of retraits) {
        expect(ligne).toMatch(/:do \{.*\} on-error=\{\}/);
      }
    });

    it('marque le debut et la fin du bloc dans le journal', async () => {
      // Deux lignes : les deux presentes, le bloc a abouti ; la premiere
      // seule, il s'est arrete en chemin et l'erreur de RouterOS est juste
      // au-dessus ; aucune, il n'a jamais demarre.
      const script = (await asA(() => service.invite('Routeur temoins'))).script;

      expect(script).toMatch(/:log info "GeMikrot : debut/);
      expect(script).toMatch(/:log info "GeMikrot : certificat/);
    });

    it('fait sortir la console du portail captif quand elle est sur le reseau', async () => {
      /**
       * Le HotSpot occupe le port 80 du routeur, et souvent le 443 avec lui.
       * Sur ce parc, le port 80 rendait une redirection vers la page du
       * portail — pris pour WebFig — et le 443 coupait sans un octet, ce qui
       * ressemble trait pour trait a un certificat d'API invalide sans en
       * etre un. Trois hypotheses ont ete bati sur cette lecture erronee.
       */
      const s = new RouterEnrollmentService(
        prisma,
        new RouterCredentialsService(config),
        new WireguardService(config),
        tenantContext,
        {
          get: (k: string) =>
            k === 'PUBLIC_BASE_URL' ? 'http://192.168.88.23:3000' : SETTINGS[k],
          getOrThrow: (k: string) => SETTINGS[k],
        } as never,
      );

      const script = (await asA(() => s.invite('Routeur portail'))).script;

      expect(script).toContain('/ip/hotspot/ip-binding/add address=192.168.88.23 type=bypassed');
      // Retire avant d'ajouter, comme tout le reste du script.
      expect(script).toMatch(/:do \{ \/ip\/hotspot\/ip-binding\/remove .* \} on-error=\{\}/);
    });

    it('ne touche pas au portail quand le serveur a une adresse publique', async () => {
      // Un serveur en production n'est pas sur le reseau du HotSpot : la ligne
      // serait au mieux inutile, au pire une adresse etrangere posee en
      // exception dans le portail d'un exploitant.
      const script = (await asA(() => service.invite('Routeur distant'))).script;

      expect(script).not.toContain('ip-binding');
    });

    it('explique ce que veut dire « timeout connecting »', async () => {
      // La panne qu'on vient de rencontrer : le port du serveur ferme par le
      // pare-feu. Sans cette ligne, on cherche la faute dans l'adresse.
      const script = (await asA(() => service.invite('Routeur pare-feu'))).script;

      expect(script).toMatch(/timeout connecting/);
      expect(script).toMatch(/pare-feu/);
    });

    it('demande le numero de serie de la carte', async () => {
      const script = (await asA(() => service.invite('Routeur serie'))).script;

      expect(script).toContain('/system/routerboard/get serial-number');
      // `:global` et non `:local` : collees une par une dans le terminal, deux
      // lignes ne partagent pas leurs variables locales, et le numero
      // arriverait vide sans que rien ne le signale. L'epreuve plus haut
      // interdit `:local` dans tout le script ; celle-ci exige la forme qui
      // marche.
      expect(script).toContain(':global gmSerie');
      expect(script).toContain('\\"serial\\":');
      // Une carte absente -- CHR, x86 -- ferait echouer la commande au lieu
      // de rendre une chaine vide : elle est donc a l'abri.
      expect(script).toMatch(/:do \{ :global gmSerie .* \} on-error=\{\}/);
      // Et la variable ne reste pas dans l'environnement du routeur.
      expect(script).toContain(':set gmSerie');
    });
  });

  /**
   * Rejouer le script ne doit plus creer une fiche de plus.
   *
   * C'est ce qui s'est passe le 24/09/2026 : trois executions sur le meme
   * appareil, trois fiches, toutes injoignables, et rien ne disait laquelle
   * etait vivante -- les deux premieres portaient des cles mortes. Et rejouer
   * est exactement ce qu'on fait quand on croit que ca n'a pas marche.
   */
  describe('le point d’appel du routeur', () => {
    it('est enregistre tel que le routeur le rapporte', async () => {
      const invitation = await asA(() => service.invite('hAP'));
      const r = await service.consume(invitation.script.match(/callback\/([\w-]+)/)![1], {
        publicKey: routerKey('m'),
        serial: `NOM${suffix}`,
        endpoint: 'abcd1234.sn.mynetname.net:13231',
      });

      const fiche = await prisma.router.findUniqueOrThrow({ where: { id: r.routerId } });
      expect(fiche.tunnelEndpoint).toBe('abcd1234.sn.mynetname.net:13231');
    });

    it('reste vide quand le nom manque, plutot que de garder un port seul', async () => {
      // `/ip/cloud` peut n'avoir pas encore repondu, ou le fournisseur peut
      // placer ce routeur derriere son propre NAT. Un << :13231 >> seul
      // ressemble a une adresse et n'en est pas : le serveur appellerait dans
      // le vide, et le tunnel resterait muet sans un mot d'explication.
      const invitation = await asA(() => service.invite('hAP sans nom'));
      const r = await service.consume(invitation.script.match(/callback\/([\w-]+)/)![1], {
        publicKey: routerKey('n'),
        serial: `SANSNOM${suffix}`,
        endpoint: ':13231',
      });

      const fiche = await prisma.router.findUniqueOrThrow({ where: { id: r.routerId } });
      expect(fiche.tunnelEndpoint).toBeNull();
    });
  });

  describe('un appareil, une fiche', () => {
    it('reprend la fiche existante quand le numero de serie est le meme', async () => {
      const serial = `HDX${suffix}`;
      const premier = await asA(() => service.invite('hAP'));
      const a = await service.consume(premier.script.match(/callback\/([\w-]+)/)![1], {
        publicKey: routerKey('f'),
        identity: 'hAP',
        serial,
      });

      const second = await asA(() => service.invite('hAP'));
      const b = await service.consume(second.script.match(/callback\/([\w-]+)/)![1], {
        publicKey: routerKey('g'),
        identity: 'hAP',
        serial,
      });

      // Meme fiche : elle garde donc ses clients, ses tickets et son journal.
      expect(b.routerId).toBe(a.routerId);
      expect(b.ficheReprise).toBe(true);

      // Et tout ce qui decrit le tunnel est remplace : le script vient de
      // reecrire l'adresse et la cle sur le routeur, et l'ancien mot de passe
      // d'API est devenu faux.
      const fiche = await prisma.router.findUniqueOrThrow({ where: { id: a.routerId } });
      expect(fiche.tunnelPublicKey).toBe(routerKey('g'));
      expect(fiche.tunnelAddress).toBe(b.tunnelAddress);
      expect(b.tunnelAddress).not.toBe(a.tunnelAddress);

      expect(await prisma.router.count({ where: { tenantId: tenantA, serialNumber: serial } })).toBe(
        1,
      );
    });

    it('cree une fiche quand le routeur ne sait pas dire son numero', async () => {
      // Une machine sans carte RouterBOARD -- CHR, x86 -- en envoie une chaine
      // vide. Deviner sur le nom serait pire : deux routeurs sortis d'usine
      // s'appellent tous les deux << MikroTik >>, et les confondre melangerait
      // les clients de deux sites.
      const un = await asA(() => service.invite('CHR'));
      const a = await service.consume(un.script.match(/callback\/([\w-]+)/)![1], {
        publicKey: routerKey('h'),
        identity: 'MikroTik',
        serial: '',
      });

      const deux = await asA(() => service.invite('CHR'));
      const b = await service.consume(deux.script.match(/callback\/([\w-]+)/)![1], {
        publicKey: routerKey('i'),
        identity: 'MikroTik',
        serial: '',
      });

      expect(b.routerId).not.toBe(a.routerId);
      expect(b.ficheReprise).toBe(false);
    });

    it('ne rapproche jamais deux exploitants sur le meme numero', async () => {
      // Deux exploitants peuvent avoir achete le meme modele, et un numero
      // recopie de travers ne doit pas faire basculer un routeur d'un parc a
      // l'autre.
      const serial = `PARTAGE${suffix}`;
      const chezA = await asA(() => service.invite('hAP'));
      const a = await service.consume(chezA.script.match(/callback\/([\w-]+)/)![1], {
        publicKey: routerKey('j'),
        serial,
      });

      const chezB = await tenantContext.runAsTenant(tenantB, () => service.invite('hAP'));
      const b = await service.consume(chezB.script.match(/callback\/([\w-]+)/)![1], {
        publicKey: routerKey('l'),
        serial,
      });

      expect(b.routerId).not.toBe(a.routerId);
      expect(b.ficheReprise).toBe(false);
    });
  });
});
