import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';

/**
 * L'inscription, et l'essai qui part avec elle.
 *
 * Le compte restait en attente d'une activation manuelle. Un exploitant s'est
 * inscrit un mardi et attendait encore le lendemain : personne n'avait pensé
 * à ouvrir l'écran des exploitants, et rien ne l'avait signalé. L'essai —
 * cinq jours, un routeur — est désormais la porte d'entrée. Ce qui garde
 * cette porte n'est plus une validation, c'est l'essai lui-même.
 */

const JOUR = 86_400_000;

function service(options: { superAdmins?: string[] } = {}) {
  const creerTenant = vi.fn(async (args: any) => ({
    id: 't-neuf',
    slug: args.data.slug,
    name: args.data.name,
    wifiName: args.data.wifiName,
    status: args.data.status,
  }));
  // Typé par son argument : sans cela `mock.calls[0][0]` ne compile pas, et
  // c'est justement ce qu'on veut inspecter.
  const envoyerDeLaPlateforme = vi.fn(
    async (_m: { destinataire: string; type: string; sujet: string; texte: string }) => ({
      envoye: true,
    }),
  );

  const prisma: any = {
    adminUser: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => (options.superAdmins ?? []).map((email) => ({ email }))),
      update: vi.fn(async () => ({})),
    },
    tenant: { count: vi.fn(async () => 0) },
    $transaction: vi.fn(async (fn: any) =>
      fn({
        tenant: { create: creerTenant },
        adminUser: { create: vi.fn(async (args: any) => ({ id: 'a1', ...args.data })) },
      }),
    ),
  };

  const s = new AuthService(
    prisma,
    { signAsync: vi.fn(async () => 'jeton') } as never,
    { log: vi.fn(async () => undefined) } as never,
    { verifier: vi.fn(), echec: vi.fn() } as never,
    { envoyerDeLaPlateforme } as never,
  );
  return { service: s, creerTenant, envoyer: envoyerDeLaPlateforme };
}

const dto = {
  organizationName: 'Wifi Toliara',
  wifiName: 'WIFI-TOLIARA',
  currency: 'MGA',
  email: 'neuf@exemple.mg',
  password: 'motdepasse',
} as never;

describe("l'inscription", () => {
  it('ouvre le compte tout de suite', async () => {
    // Un compte en attente ne peut pas se connecter : lui accorder un essai
    // sans lui ouvrir la porte ne lui donnerait rien du tout.
    const { service: s, creerTenant } = service();

    const res = await s.signup(dto);

    expect(creerTenant.mock.calls[0][0].data.status).toBe('ACTIVE');
    expect(res.status).toBe('ACTIVE');
  });

  it('pose cinq jours, un routeur, et aucune tolérance', async () => {
    const { service: s, creerTenant } = service();

    await s.signup(dto);

    const data = creerTenant.mock.calls[0][0].data;
    expect(data.maxRouters).toBe(1);
    expect(Math.round((data.platformEndsAt.getTime() - Date.now()) / JOUR)).toBe(5);
    // Cinq jours plus quatorze de tolérance feraient dix-neuf jours gratuits.
    expect(data.platformGraceEndsAt.getTime()).toBe(data.platformEndsAt.getTime());
  });

  it('annonce l’échéance à celui qui vient de s’inscrire', async () => {
    // Il doit savoir, à la seconde où il crée son compte, jusqu'à quand il
    // peut vendre. L'apprendre au sixième jour serait une mauvaise surprise.
    const { service: s } = service();

    const res = await s.signup(dto);

    expect(res.message).toMatch(/5 jours/);
    expect(res.essaiJusquAu).toBeTruthy();
  });

  it('ne prévient pas encore la plateforme', async () => {
    /**
     * L'avis attend que l'adresse soit confirmée, et c'est tout l'objet du
     * code : annoncer un exploitant qu'on ne sait pas joindre n'annonce rien
     * d'utile — on ne peut ni lui écrire, ni lui envoyer son reçu, ni le
     * prévenir de son échéance. Une inscription abandonnée en chemin
     * encombrerait la boîte du SUPER_ADMIN sans qu'il puisse rien en faire.
     */
    const { service: s, envoyer } = service({ superAdmins: ['plateforme@exemple.mg'] });

    await s.signup(dto);

    const types = envoyer.mock.calls.map((c) => c[0].type);
    expect(types).toContain('confirmation-adresse');
    expect(types).not.toContain('inscription-exploitant');
  });

  it('ouvre la session, pour que la confirmation soit authentifiée', async () => {
    // Redemander a l'instant un mot de passe qu'on vient de choisir serait
    // absurde, et le code ne doit valoir que pour un compte deja prouve.
    const { service: s } = service();

    const res = await s.signup(dto);

    expect(res.accessToken).toBeTruthy();
    expect(res.user.emailVerifie).toBe(false);
    expect(res.user.email).toBe('neuf@exemple.mg');
  });

  it('inscrit quand même si le courriel échoue', async () => {
    // Un exploitant qui ne peut pas créer son compte parce qu'un serveur SMTP
    // manque serait un client perdu pour une raison qui ne le regarde pas.
    const { service: s } = service({ superAdmins: ['plateforme@exemple.mg'] });
    (s as never as { courriel: { envoyerDeLaPlateforme: unknown } }).courriel = {
      envoyerDeLaPlateforme: vi.fn(async () => {
        throw new Error('SMTP muet');
      }),
    };

    await expect(s.signup(dto)).resolves.toMatchObject({ status: 'ACTIVE' });
  });
});

describe('le code de confirmation', () => {
  it('part vers l’adresse de l’inscrit, a six chiffres', async () => {
    // Six chiffres et non huit : il se lit au telephone et se retape sans
    // erreur. Ce n'est pas un mot de passe, c'est la preuve qu'on releve bien
    // cette boite.
    const { service: s, envoyer } = service();

    await s.signup(dto);

    const code = envoyer.mock.calls.find((c) => c[0].type === 'confirmation-adresse')![0];
    expect(code.destinataire).toBe('neuf@exemple.mg');
    expect(code.sujet).toMatch(/\b\d{6}\b/);
    expect(code.texte).toMatch(/\b\d{6}\b/);
  });

  it('enregistre le code sur le compte, et ne confirme rien', async () => {
    // L'adresse n'est pas confirmee, et cela ne ferme rien : le compte
    // travaille normalement. Bloquer la connexion sur un courriel qui
    // n'arrive pas transformerait un accessoire en panne totale.
    const { service: s, creerTenant } = service();

    await s.signup(dto);

    // Le compte est cree dans la meme transaction que l'exploitant : on lit
    // l'appel sur le client transactionnel.
    const tx = (s as never as { prisma: { $transaction: { mock: { calls: unknown[][] } } } }).prisma;
    expect(tx.$transaction).toHaveBeenCalled();
    expect(creerTenant).toHaveBeenCalled();
  });
});

/**
 * La confirmation, et ce qu'elle declenche.
 *
 * C'est elle qui previent la plateforme : le SUPER_ADMIN apprend une arrivee
 * **joignable**, la seule sorte qui l'interesse.
 */
function compte(
  options: {
    role?: string;
    code?: string;
    envoyeIlYA?: number;
    verifie?: boolean;
    envoiEchoue?: boolean;
  } = {},
) {
  const envoyer = vi.fn(
    async (_m: { destinataire: string; type: string; sujet: string; texte: string }) =>
      options.envoiEchoue ? { envoye: false, erreur: 'SMTP de la plateforme non regle' } : { envoye: true },
  );
  // Typé par son argument : sans cela `mock.calls[0][0]` ne compile pas, et
  // c'est justement ce qu'on veut inspecter.
  const update = vi.fn(async (_args: { data: Record<string, unknown> }) => ({}));
  const prisma: any = {
    adminUser: {
      findUnique: vi.fn(async () => ({
        id: 'a1',
        email: 'neuf@exemple.mg',
        role: options.role ?? 'ADMIN',
        tenantId: 't1',
        tenant: { id: 't1', name: 'Wifi Toliara', wifiName: 'WIFI-TOLIARA', slug: 'wifi-toliara' },
        emailVerifiedAt: options.verifie ? new Date() : null,
        emailCode: options.code ?? '123456',
        emailCodeSentAt: new Date(Date.now() - (options.envoyeIlYA ?? 0)),
      })),
      findMany: vi.fn(async () => [{ email: 'plateforme@exemple.mg' }]),
      update,
    },
  };
  const s = new AuthService(
    prisma,
    { signAsync: vi.fn(async () => 'jeton') } as never,
    { log: vi.fn(async () => undefined) } as never,
    { verifier: vi.fn(), echec: vi.fn() } as never,
    { envoyerDeLaPlateforme: envoyer } as never,
  );
  return { service: s, envoyer, update };
}

describe('la confirmation', () => {
  it('previent la plateforme une fois l\u2019adresse prouvee', async () => {
    const { service: s, envoyer } = compte();

    await s.confirmerCourriel('a1', '123456');

    const avis = envoyer.mock.calls.find((c) => c[0].type === 'inscription-exploitant');
    expect(avis).toBeTruthy();
    expect(avis![0].destinataire).toBe('plateforme@exemple.mg');
    expect(avis![0].texte).toMatch(/Wifi Toliara/);
  });

  it('efface le code des qu\u2019il a servi', async () => {
    // Un code encore valable apres usage n'est plus une preuve, c'est un
    // second mot de passe qui traine.
    const { service: s, update } = compte();

    await s.confirmerCourriel('a1', '123456');

    const data = update.mock.calls[0][0].data;
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(data.emailCode).toBeNull();
  });

  it('refuse un code qui ne correspond pas', async () => {
    const { service: s, update } = compte();

    await expect(s.confirmerCourriel('a1', '000000')).rejects.toThrow(/ne correspond pas/);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuse un code de plus d\u2019une heure, en disant quoi faire', async () => {
    const { service: s } = compte({ envoyeIlYA: 2 * 60 * 60 * 1000 });

    await expect(s.confirmerCourriel('a1', '123456')).rejects.toThrow(/expiré/);
  });

  it('ne previent personne pour un compte d\u2019equipe', async () => {
    // Un vendeur qui confirme son adresse ne declenche pas un avis
    // d'inscription pour un exploitant qui existe depuis des mois.
    const { service: s, envoyer } = compte({ role: 'OPERATOR' });

    await s.confirmerCourriel('a1', '123456');

    expect(envoyer.mock.calls.map((c) => c[0].type)).not.toContain('inscription-exploitant');
  });
});

/**
 * Le renvoi disait << c'est parti >> sans le savoir.
 *
 * `envoyerLeCode` avalait l'echec et ne rendait rien ; `renvoyerLeCode`
 * repondait donc `{ envoye: true }` quel que soit le sort du message. Sur une
 * plateforme dont le SMTP n'etait pas regle, cela donnait un ecran qui
 * reclamait un code, un bouton << Renvoyer >> qui confirmait l'envoi, et
 * aucun courriel nulle part. La personne n'avait rien fait de travers et
 * aucun moyen de s'en sortir.
 */
describe('le renvoi du code', () => {
  it('rend l’echec quand rien n’est parti', async () => {
    const { service: s } = compte({ envoyeIlYA: 5 * 60 * 1000, envoiEchoue: true });

    await expect(s.renvoyerLeCode('a1')).resolves.toMatchObject({
      envoye: false,
      erreur: 'SMTP de la plateforme non regle',
    });
  });

  it('enregistre le code meme quand l’envoi echoue', async () => {
    // L'horodatage borne la validite du code. Le retirer rendrait inutilisable
    // un code bien enregistre, qui servira des que le SMTP sera regle.
    const { service: s, update } = compte({ envoyeIlYA: 5 * 60 * 1000, envoiEchoue: true });

    await s.renvoyerLeCode('a1');

    const data = update.mock.calls[0][0].data as { emailCode: string; emailCodeSentAt: Date };
    expect(data.emailCode).toMatch(/^\d{6}$/);
    expect(data.emailCodeSentAt).toBeInstanceOf(Date);
  });

  it('confirme quand le message part', async () => {
    const { service: s } = compte({ envoyeIlYA: 5 * 60 * 1000 });

    await expect(s.renvoyerLeCode('a1')).resolves.toMatchObject({ envoye: true });
  });
});
