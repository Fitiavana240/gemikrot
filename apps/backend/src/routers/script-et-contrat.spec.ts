import { describe, expect, it } from 'vitest';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { RouterCredentialsService } from './router-credentials.service.js';
import { RouterEnrollmentService } from './router-enrollment.service.js';
import { WireguardService } from './wireguard.service.js';
import { EnrollRouterDto } from './router-enrollment.controller.js';

/**
 * Le script et le contrat doivent parler la même langue.
 *
 * Le serveur valide le rappel avec `forbidNonWhitelisted` : **un champ
 * inconnu fait rejeter la requête entière**, pas seulement ce champ. Le
 * routeur lit alors « Status 400, Bad Request » après un script qui s'est
 * pourtant déroulé jusqu'au bout — tunnel posé, compte créé, certificat en
 * cours — et rien à l'écran ne dit lequel des champs pose problème.
 *
 * C'est arrivé le 24/09/2026 : le script s'était mis à envoyer `endpoint`,
 * le contrat ne l'avait pas suivi. Les deux fichiers compilaient, les
 * épreuves passaient, et la seule façon de le voir était de coller le script
 * sur un vrai routeur.
 *
 * Ces épreuves lisent les noms de champs **dans le script lui-même** plutôt
 * que dans une liste recopiée : une liste diverge, le script est la source.
 */

const REGLAGES: Record<string, string> = {
  ROUTER_CREDENTIALS_KEY: 'a'.repeat(64),
  WIREGUARD_ENDPOINT_HOST: 'vps.gemikrot.mg',
  WIREGUARD_SERVER_PUBLIC_KEY: 'k'.repeat(43) + '=',
  WIREGUARD_SUBNET: '10.88.0.0/24',
  WIREGUARD_SERVER_ADDRESS: '10.88.0.1',
  PUBLIC_BASE_URL: 'https://vps.gemikrot.mg',
};
const config = {
  get: (k: string) => REGLAGES[k],
  getOrThrow: (k: string) => REGLAGES[k],
} as unknown as ConfigService;

/** Le service, monté sans base : seul le texte du script nous intéresse. */
function service() {
  const tenantContext = new TenantContextService();
  const prisma = {
    scopedStrict: {
      routerEnrollment: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'e1',
          ...data,
        }),
        findMany: async () => [],
      },
      router: { findMany: async () => [] },
    },
    // Le plan d'adressage se lit hors cloisonnement : une adresse prise l'est
    // pour tout le monde. Le simulacre doit donc porter les deux formes.
    router: { findMany: async () => [] },
    routerEnrollment: {
      deleteMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
  } as unknown as PrismaService;

  // Le contexte est rendu avec le service : `run` doit porter sur **la meme
  // instance** que celle qu'il interroge, sinon l'exploitant n'y est pas.
  return {
    service: new RouterEnrollmentService(
      prisma,
      new RouterCredentialsService(config),
      new WireguardService(config),
      tenantContext,
      config,
    ),
    tenantContext,
  };
}

/**
 * Les noms de champs que le script envoie, lus dans le script.
 *
 * Le corps est construit par concaténation RouterOS :
 * `("{\"publicKey\":\"" . [...] . "\",\"identity\":\"" . [...] . "\"}")`.
 * Les noms se reconnaissent à la forme `\"nom\":`.
 */
function champsEnvoyes(script: string): string[] {
  const ligne = script.split(/\r?\n/).find((l) => l.startsWith('/tool/fetch'));
  expect(ligne, 'le script ne contient aucun appel /tool/fetch').toBeDefined();
  return [...ligne!.matchAll(/\\"([a-zA-Z]+)\\":/g)].map((m) => m[1]!);
}

describe('le rappel que le script envoie', () => {
  it('ne contient que des champs que le contrat accepte', async () => {
    const { service: s, tenantContext } = service();
    const script = await tenantContext.run({ tenantId: 't1', isSuperAdmin: false }, () =>
      s.invite('hAP'),
    );

    const champs = champsEnvoyes(script.script);
    expect(champs.length).toBeGreaterThan(0);

    // Un corps qui porte tous ces champs doit passer la validation. Le
    // message d'échec nomme le champ fautif — c'est exactement ce que le
    // routeur ne pouvait pas nous dire.
    const corps = Object.fromEntries(
      champs.map((c) => [c, c === 'publicKey' ? 'x'.repeat(43) + '=' : 'valeur']),
    );
    const erreurs = validateSync(plainToInstance(EnrollRouterDto, corps), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(
      erreurs.map((e) => `${e.property} : ${Object.values(e.constraints ?? {}).join(', ')}`),
      `Le script envoie ces champs : ${champs.join(', ')}. ` +
        `Tout champ absent du contrat fait rejeter la requete entiere, et le ` +
        `routeur ne lit qu'un « Status 400 » sans explication.`,
    ).toEqual([]);
  });

  it('accepte un point d’appel sans nom', async () => {
    // `/ip/cloud` peut n'avoir pas encore repondu : le script envoie alors
    // « :13231 ». Le refuser ferait echouer un raccordement qui, lui, a
    // marche — et le routeur ne saurait pas pourquoi.
    const corps = {
      publicKey: 'x'.repeat(43) + '=',
      identity: 'hAP',
      serial: '',
      endpoint: ':13231',
    };

    const erreurs = validateSync(plainToInstance(EnrollRouterDto, corps), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(erreurs).toEqual([]);
  });

  it('refuse un champ que le script n’envoie pas', () => {
    // La garantie ne vaut que si la validation mord vraiment : une epreuve
    // qui ne peut pas echouer ne prouve rien.
    const erreurs = validateSync(
      plainToInstance(EnrollRouterDto, {
        publicKey: 'x'.repeat(43) + '=',
        inconnu: 'quelque chose',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );

    expect(erreurs.map((e) => e.property)).toContain('inconnu');
  });
});
