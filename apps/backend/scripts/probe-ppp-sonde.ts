/**
 * Relève la forme réelle des objets PPPoE en les créant le temps du sondage.
 *
 * `probe-ppp.ts` lit ce qui existe. Sur un parc qui ne vend pas de PPPoE, il
 * ne trouve rien : deux profils par défaut dont RouterOS omet tous les champs
 * non renseignés, et aucun compte. Impossible d'en tirer la forme d'un profil
 * configuré ni celle d'un compte.
 *
 * Ce script crée donc le minimum, relève, et **supprime tout**, y compris si
 * le relevé échoue en route. Les objets portent tous le préfixe
 * `gemikrot-sonde-` : ce qui survivrait à un plantage se reconnaît et
 * s'enlève à la main.
 *
 * Le serveur PPPoE est posé **désactivé**, sur une interface sans rien de
 * branché : on veut la forme de l'objet, pas un service qui répond.
 *
 * Usage, depuis apps/backend. Sans identifiants, ceux du `.env` servent :
 * un mot de passe de routeur n'a pas à traîner dans l'historique du terminal.
 *
 *     npx tsx scripts/probe-ppp-sonde.ts
 *     npx tsx scripts/probe-ppp-sonde.ts https://192.168.88.1 compte motdepasse ether4
 */
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIXE = 'gemikrot-sonde-';
const SECRET_FIELDS = new Set(['password', 'caller-id-password']);

interface Cree {
  collection: string;
  id: string;
}

async function main(): Promise<void> {
  const [urlArg, userArg, passArg, iface = 'ether4'] = process.argv.slice(2);
  const env = lireEnv();
  const baseUrl = urlArg ?? env.MIKROTIK_BASE_URL;
  const username = userArg ?? env.MIKROTIK_USERNAME;
  const password = passArg ?? env.MIKROTIK_PASSWORD;

  if (!baseUrl || !username || !password) {
    console.error(
      'Identifiants introuvables. Renseigner MIKROTIK_BASE_URL / _USERNAME / _PASSWORD dans .env,\n' +
        'ou : npx tsx scripts/probe-ppp-sonde.ts <url> <compte> <motdepasse> [interface]',
    );
    process.exit(1);
  }

  const dispatcher = new Agent({ connect: buildConnector({ rejectUnauthorized: false }) });
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  const appel = async (method: string, chemin: string, corps?: unknown) => {
    const response = await undiciFetch(`${baseUrl}/rest${chemin}`, {
      method,
      headers: { authorization, 'content-type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      dispatcher,
      signal: AbortSignal.timeout(20_000),
    });
    const texte = await response.text();
    if (!response.ok) throw new Error(`${method} ${chemin} → HTTP ${response.status} ${texte}`);
    return texte ? JSON.parse(texte) : null;
  };

  const crees: Cree[] = [];
  const relevé: Record<string, unknown> = {
    relevéLe: new Date().toISOString(),
    routeur: baseUrl,
    méthode: 'objets créés le temps du sondage puis supprimés',
  };

  try {
    // 1. Un bassin d'adresses, dont le profil se sert pour l'adresse distante.
    const pool = await appel('PUT', '/ip/pool', {
      name: `${PREFIXE}pool`,
      ranges: '10.77.0.10-10.77.0.20',
    });
    crees.push({ collection: '/ip/pool', id: pool['.id'] });

    // 2. Un profil réellement configuré : c'est tout l'objet du sondage, les
    //    profils par défaut n'exposant aucun des champs qui nous intéressent.
    const profil = await appel('PUT', '/ppp/profile', {
      name: `${PREFIXE}profil`,
      'local-address': '10.77.0.1',
      'remote-address': `${PREFIXE}pool`,
      'rate-limit': '2M/2M',
      'dns-server': '8.8.8.8',
      'only-one': 'yes',
      'change-tcp-mss': 'yes',
      comment: 'GeMikrot — sondage, à supprimer',
    });
    crees.push({ collection: '/ppp/profile', id: profil['.id'] });

    // 3. Un compte. Son mot de passe est aléatoire et l'objet ne vit que
    //    quelques secondes, mais il est caviardé avant écriture comme les autres.
    const compte = await appel('PUT', '/ppp/secret', {
      name: `${PREFIXE}compte`,
      password: Math.random().toString(36).slice(2),
      service: 'pppoe',
      profile: `${PREFIXE}profil`,
      comment: 'GeMikrot — sondage, à supprimer',
    });
    crees.push({ collection: '/ppp/secret', id: compte['.id'] });

    // 4. Le serveur, désactivé, sur une interface sans rien de branché.
    const serveur = await appel('PUT', '/interface/pppoe-server/server', {
      'service-name': `${PREFIXE}svc`,
      interface: iface,
      'default-profile': `${PREFIXE}profil`,
      disabled: 'yes',
      'one-session-per-host': 'yes',
    });
    crees.push({ collection: '/interface/pppoe-server/server', id: serveur['.id'] });

    console.log(`${crees.length} objet(s) créé(s) sur ${iface}, relevé en cours…\n`);

    for (const collection of [
      '/ppp/profile',
      '/ppp/secret',
      '/interface/pppoe-server/server',
      '/ip/pool',
    ]) {
      const rows = (await appel('GET', collection)) as Record<string, unknown>[];
      const miennes = rows.filter((row) => String(row.name ?? row['service-name'] ?? '').startsWith(PREFIXE));
      relevé[collection] = miennes.map(censor);
      console.log(`${collection} : ${miennes.length} relevée(s)`);
      if (miennes.length > 0) {
        console.log(`  champs : ${Object.keys(miennes[0]).sort().join(', ')}`);
      }
    }
  } finally {
    // Le nettoyage passe avant tout le reste, y compris avant de signaler une
    // erreur : laisser des objets derrière soi sur un routeur en production
    // serait pire que de ne pas avoir sondé.
    for (const { collection, id } of crees.reverse()) {
      try {
        await appel('DELETE', `${collection}/${id}`);
        console.log(`supprimé : ${collection}/${id}`);
      } catch (error) {
        console.error(`À SUPPRIMER À LA MAIN : ${collection}/${id} — ${String(error)}`);
      }
    }
  }

  const dossier = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routers', '__fixtures__');
  mkdirSync(dossier, { recursive: true });
  const chemin = join(dossier, `ppp-sonde-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(chemin, JSON.stringify(relevé, null, 2), 'utf8');
  console.log(`\nRelevé écrit : ${chemin}`);
}

/** Lecture minimale du `.env` : pas de dépendance pour trois valeurs. */
function lireEnv(): Record<string, string> {
  try {
    const brut = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const valeurs: Record<string, string> = {};
    for (const ligne of brut.split(/\r?\n/)) {
      const m = ligne.match(/^([A-Z_]+)="?([^"]*)"?\s*$/);
      if (m) valeurs[m[1]] = m[2];
    }
    return valeurs;
  } catch {
    return {};
  }
}

function censor(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    clean[key] = SECRET_FIELDS.has(key) ? '***' : value;
  }
  return clean;
}

void main();
