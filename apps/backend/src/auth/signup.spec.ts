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
  const envoyer = vi.fn(async (_message: { destinataire: string; type: string }) => undefined);

  const prisma: any = {
    adminUser: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => (options.superAdmins ?? []).map((email) => ({ email }))),
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
    { envoyer } as never,
  );
  return { service: s, creerTenant, envoyer };
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

  it('prévient les comptes de la plateforme', async () => {
    // Le compte s'ouvre seul, mais savoir qui arrive reste le travail du
    // SUPER_ADMIN — et il n'ouvre pas l'écran des exploitants chaque matin.
    const { service: s, envoyer } = service({ superAdmins: ['plateforme@exemple.mg'] });

    await s.signup(dto);

    expect(envoyer).toHaveBeenCalledTimes(1);
    expect(envoyer.mock.calls[0][0].destinataire).toBe('plateforme@exemple.mg');
    expect(envoyer.mock.calls[0][0].type).toBe('inscription-exploitant');
  });

  it('inscrit quand même si le courriel échoue', async () => {
    // Un exploitant qui ne peut pas créer son compte parce qu'un serveur SMTP
    // manque serait un client perdu pour une raison qui ne le regarde pas.
    const { service: s } = service({ superAdmins: ['plateforme@exemple.mg'] });
    (s as never as { courriel: { envoyer: unknown } }).courriel = {
      envoyer: vi.fn(async () => {
        throw new Error('SMTP muet');
      }),
    };

    await expect(s.signup(dto)).resolves.toMatchObject({ status: 'ACTIVE' });
  });
});
