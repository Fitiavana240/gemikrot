import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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

  // Représente le hAP ac² unique décrit Section 7. La vraie connexion
  // RouterOS reste pilotée par MIKROTIK_BASE_URL/USERNAME/PASSWORD
  // (src/mikrotik) : cette ligne sert de référence pour les clés étrangères
  // (VoucherBatch, AuditLog, caches), pas de source de connexion.
  const routerHost = new URL(process.env.MIKROTIK_BASE_URL ?? 'https://192.168.88.1').hostname;
  const router = await prisma.router.upsert({
    where: { id: 'default-router' },
    update: {},
    create: {
      id: 'default-router',
      label: 'hAP ac² — Zone WIFI-TATI',
      host: routerHost,
      credentialsEncrypted: 'unused-see-mikrotik-env-vars',
    },
  });
  console.log(`Routeur par défaut prêt : ${router.label} (${router.host})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
