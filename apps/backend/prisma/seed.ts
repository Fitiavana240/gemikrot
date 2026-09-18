import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createCipheriv, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

/**
 * Même format que `RouterCredentialsService` (src/routers) : `iv.tag.data` en
 * base64url, AES-256-GCM. Dupliqué ici volontairement — le seed tourne hors
 * du conteneur d'injection Nest et ne doit pas instancier l'application.
 */
function encryptCredentials(username: string, password: string): string {
  const rawKey = process.env.ROUTER_CREDENTIALS_KEY;
  if (!rawKey) {
    throw new Error('ROUTER_CREDENTIALS_KEY manquant — voir apps/backend/.env.example');
  }
  const key = Buffer.from(rawKey, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ username, password }), 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext].map((p) => p.toString('base64url')).join('.');
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@wifitati.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

  const admin = await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'SUPER_ADMIN',
    },
  });
  console.log(`SUPER_ADMIN prêt : ${admin.email}`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`  mot de passe par défaut "${adminPassword}" — à changer immédiatement.`);
  }

  // Le routeur en base pilote désormais réellement la connexion : les
  // identifiants de `.env` y sont recopiés chiffrés (Section 35), ce qui fait
  // la passerelle vers le modèle multi-routeurs sans coupure.
  const baseUrl = new URL(process.env.MIKROTIK_BASE_URL ?? 'https://192.168.88.1');
  const username = process.env.MIKROTIK_USERNAME;
  const password = process.env.MIKROTIK_PASSWORD;

  const routerData = {
    label: 'hAP ac² — Zone WIFI-TATI',
    host: baseUrl.hostname,
    restPort: baseUrl.port ? Number(baseUrl.port) : 443,
    ...(username && password
      ? { credentialsEncrypted: encryptCredentials(username, password) }
      : {}),
  };

  const router = await prisma.router.upsert({
    where: { id: 'default-router' },
    update: routerData,
    create: {
      id: 'default-router',
      ...routerData,
      credentialsEncrypted:
        routerData.credentialsEncrypted ?? encryptCredentials('', ''),
    },
  });
  console.log(`Routeur par défaut prêt : ${router.label} (${router.host}:${router.restPort})`);
  if (!username || !password) {
    console.log('  MIKROTIK_USERNAME/PASSWORD absents — identifiants à renseigner via l\'API.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
