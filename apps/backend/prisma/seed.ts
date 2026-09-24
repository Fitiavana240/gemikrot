import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createCipheriv, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

/** Même identifiant que celui posé par la migration multi-locataires, pour
 * qu'un seed rejoué ne crée pas un second exploitant à côté de l'existant. */
const DEFAULT_TENANT_ID = 'default-tenant';

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
  // Le SUPER_ADMIN exploite la plateforme (accès à tout), par opposition aux
  // ADMIN qui en sont les clients. Ses identifiants viennent de `.env` et ne
  // sont jamais écrits dans le code : le dépôt ne doit pas porter de mot de
  // passe réel.
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error(
      'SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD sont requis — voir apps/backend/.env.example',
    );
  }
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  const admin = await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: { passwordHash, role: 'SUPER_ADMIN' },
    create: { email: adminEmail, passwordHash, role: 'SUPER_ADMIN' },
  });
  console.log(`SUPER_ADMIN prêt : ${admin.email}`);

  // L'exploitant d'origine. La migration multi-locataires l'a déjà créé sur
  // une base existante ; l'upsert n'est là que pour qu'une base vierge
  // obtienne le même point de départ, sans écraser une marque déjà
  // personnalisée par l'exploitant (d'où l'`update` vide).
  const tenant = await prisma.tenant.upsert({
    where: { id: DEFAULT_TENANT_ID },
    update: {},
    create: {
      id: DEFAULT_TENANT_ID,
      slug: 'zone-wifi-tati',
      name: 'Zone WIFI-TATI',
      wifiName: 'Zone WIFI-TATI',
      domains: ['wifitati.net'],
      currency: 'MGA',
      status: 'ACTIVE',
    },
  });
  console.log(`Exploitant prêt : ${tenant.name} (devise ${tenant.currency})`);

  /**
   * Le routeur d'origine — **et seulement si on le demande**.
   *
   * Il était créé d'office, en `192.168.88.1`, du temps où la plateforme ne
   * servait qu'un seul parc. Sur un serveur neuf c'est une fiche que rien ne
   * peut joindre : elle s'affiche « injoignable » dès la première
   * connexion, sans que personne sache d'où elle sort, et il faut penser à la
   * supprimer. Exactement le genre de fantôme qui a coûté une journée de
   * diagnostic sur ce projet.
   *
   * Les routeurs se raccordent désormais depuis la console, par un script qui
   * rapporte leur numéro de série et leur clé. En créer un d'avance n'aide
   * personne.
   */
  const username = process.env.MIKROTIK_USERNAME;
  const password = process.env.MIKROTIK_PASSWORD;
  if (!username || !password) {
    console.log('Aucun routeur créé : raccordez-le depuis la console, écran Routeurs.');
    return;
  }
  const baseUrl = new URL(process.env.MIKROTIK_BASE_URL ?? 'https://192.168.88.1');

  const routerData = {
    tenantId: tenant.id,
    label: 'hAP ac² — Zone WIFI-TATI',
    host: baseUrl.hostname,
    restPort: baseUrl.port ? Number(baseUrl.port) : 443,
    credentialsEncrypted: encryptCredentials(username, password),
  };

  const router = await prisma.router.upsert({
    where: { id: 'default-router' },
    update: routerData,
    create: { id: 'default-router', ...routerData },
  });
  console.log(`Routeur par défaut prêt : ${router.label} (${router.host}:${router.restPort})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
