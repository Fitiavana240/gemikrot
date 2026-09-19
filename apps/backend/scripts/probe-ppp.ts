/**
 * Relève les charges utiles PPPoE brutes d'un routeur réel.
 *
 * Ce projet a retenu quatre erreurs de correspondance écrites de bonne foi
 * sur la seule documentation RouterOS : un débit lu sur un champ inexistant,
 * des dates de session sous d'autres noms, une attribution supposée unique
 * alors qu'elle ne l'est pas, un fuseau horaire absent des dates renvoyées.
 * Chacune n'a été trouvée qu'au contact du matériel.
 *
 * La règle qui en découle est écrite dans le document de référence : sonder
 * avant d'écrire, puis figer la charge relevée dans un test. PPPoE n'a jamais
 * été sondé — ce script est la première moitié du travail, et il rend la
 * seconde mécanique.
 *
 * Usage, depuis apps/backend, connecté au réseau du routeur :
 *
 *     npx tsx scripts/probe-ppp.ts https://192.168.88.1 compte motdepasse
 *
 * Le résultat s'écrit dans `src/routers/__fixtures__/ppp-<date>.json`, à
 * joindre tel quel au test des correspondances. Les mots de passe des comptes
 * PPPoE sont remplacés avant écriture : un relevé finit dans le dépôt.
 */
import { Agent, buildConnector, fetch as undiciFetch } from 'undici';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Les collections qui composent le domaine PPPoE, dans l'ordre utile. */
const ENDPOINTS = [
  '/ppp/secret',
  '/ppp/profile',
  '/ppp/active',
  '/interface/pppoe-server/server',
  '/ppp/aaa',
  '/ip/pool',
] as const;

/** Champs à ne jamais écrire dans un fichier versionné. */
const SECRET_FIELDS = new Set(['password', 'caller-id-password']);

async function main(): Promise<void> {
  const [baseUrl, username, password] = process.argv.slice(2);
  if (!baseUrl || !username || !password) {
    console.error('Usage : npx tsx scripts/probe-ppp.ts <url> <compte> <motdepasse>');
    process.exit(1);
  }

  // Le certificat du routeur est auto-signé tant qu'il n'est pas épinglé.
  // Même transport que l'application : `fetch` global n'honore pas toujours
  // la variable d'environnement, et un relevé qui échoue pour une raison de
  // TLS ne dit rien du routeur.
  const dispatcher = new Agent({ connect: buildConnector({ rejectUnauthorized: false }) });
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

  const relevé: Record<string, unknown> = {
    relevéLe: new Date().toISOString(),
    routeur: baseUrl,
  };

  for (const endpoint of ENDPOINTS) {
    try {
      const response = await undiciFetch(`${baseUrl}/rest${endpoint}`, {
        headers: { authorization },
        dispatcher,
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        // Un 404 est une information : la collection n'existe pas sur cette
        // version, et c'est exactement ce qu'il faut savoir avant d'écrire.
        relevé[endpoint] = { erreur: `HTTP ${response.status}`, corps: await response.text() };
        console.log(`${endpoint} : HTTP ${response.status}`);
        continue;
      }

      const rows = (await response.json()) as Record<string, unknown>[];
      relevé[endpoint] = rows.map(censor);
      console.log(`${endpoint} : ${rows.length} entrée(s)`);
      if (rows.length > 0) {
        console.log(`  champs : ${Object.keys(rows[0]).sort().join(', ')}`);
      }
    } catch (error) {
      relevé[endpoint] = { erreur: String(error) };
      console.log(`${endpoint} : ${String(error)}`);
    }
  }

  const dossier = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routers', '__fixtures__');
  mkdirSync(dossier, { recursive: true });
  const chemin = join(dossier, `ppp-${new Date().toISOString().slice(0, 10)}.json`);
  writeFileSync(chemin, JSON.stringify(relevé, null, 2), 'utf8');

  console.log(`\nRelevé écrit : ${chemin}`);
  console.log(
    'Prochaine étape : écrire les correspondances PPPoE contre ce fichier, et le figer dans un test.',
  );
}

function censor(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    clean[key] = SECRET_FIELDS.has(key) ? '***' : value;
  }
  return clean;
}

void main();
