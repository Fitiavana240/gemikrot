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

    it('explique ce que veut dire « timeout connecting »', async () => {
      // La panne qu'on vient de rencontrer : le port du serveur ferme par le
      // pare-feu. Sans cette ligne, on cherche la faute dans l'adresse.
      const script = (await asA(() => service.invite('Routeur pare-feu'))).script;

      expect(script).toMatch(/timeout connecting/);
      expect(script).toMatch(/pare-feu/);
    });
  });
});
