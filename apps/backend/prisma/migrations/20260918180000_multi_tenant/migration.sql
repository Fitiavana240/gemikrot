-- Passage au multi-locataires.
--
-- Écrite à la main plutôt que générée : la version automatique remplaçait
-- `price_ar`/`amount_ar` par un DROP + ADD, ce qui aurait effacé les prix et
-- les montants déjà enregistrés. Ici les colonnes sont renommées, et les
-- lignes existantes sont rattachées à un exploitant créé pour l'occasion.

-- 1. Exploitants -------------------------------------------------------------

CREATE TYPE "TenantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wifi_name" TEXT NOT NULL,
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "logo_url" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'MGA',
    "status" "TenantStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mobile_money_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" "PaymentMethod" NOT NULL,
    "phone_number" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mobile_money_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mobile_money_accounts_tenant_id_idx" ON "mobile_money_accounts"("tenant_id");
CREATE UNIQUE INDEX "mobile_money_accounts_provider_phone_number_key" ON "mobile_money_accounts"("provider", "phone_number");

-- L'exploitant qui reprend tout l'existant (Zone WIFI-TATI).
INSERT INTO "tenants" ("id", "name", "wifi_name", "domains", "currency", "status", "created_at", "updated_at")
VALUES ('default-tenant', 'Zone WIFI-TATI', 'Zone WIFI-TATI', ARRAY['wifitati.net'], 'MGA', 'ACTIVE', NOW(), NOW());

-- 2. `starts-when` aligné sur le vocabulaire RouterOS -------------------------
-- LOGON correspond à `first-auth`, CREATION à `assigned`.

ALTER TABLE "plans" ALTER COLUMN "starts_when" DROP DEFAULT;
ALTER TABLE "plans" ALTER COLUMN "starts_when" TYPE TEXT USING ("starts_when"::TEXT);
UPDATE "plans" SET "starts_when" = 'FIRST_AUTH' WHERE "starts_when" = 'LOGON';
UPDATE "plans" SET "starts_when" = 'ASSIGNED' WHERE "starts_when" = 'CREATION';
DROP TYPE "ProfileStartsWhen";
CREATE TYPE "ProfileStartsWhen" AS ENUM ('FIRST_AUTH', 'ASSIGNED');
ALTER TABLE "plans" ALTER COLUMN "starts_when" TYPE "ProfileStartsWhen" USING ("starts_when"::"ProfileStartsWhen");
ALTER TABLE "plans" ALTER COLUMN "starts_when" SET DEFAULT 'FIRST_AUTH';

-- 3. Montants indépendants de la devise (renommage, sans perte) ---------------

ALTER TABLE "plans" RENAME COLUMN "price_ar" TO "price";
ALTER TABLE "vouchers" RENAME COLUMN "price_ar" TO "price";
ALTER TABLE "payments" RENAME COLUMN "amount_ar" TO "amount";
ALTER TABLE "payments" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'MGA';
ALTER TABLE "payments" ALTER COLUMN "currency" DROP DEFAULT;

-- 4. Rattachement des données existantes --------------------------------------
-- Ajoutées en NULL, remplies, puis rendues obligatoires : une colonne NOT NULL
-- posée directement échouerait sur les tables déjà peuplées.

ALTER TABLE "admin_users" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "routers" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "plans" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "customers" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "devices" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "voucher_batches" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "vouchers" ADD COLUMN "tenant_id" TEXT;
ALTER TABLE "payments" ADD COLUMN "tenant_id" TEXT;

UPDATE "routers" SET "tenant_id" = 'default-tenant';
UPDATE "plans" SET "tenant_id" = 'default-tenant';
UPDATE "customers" SET "tenant_id" = 'default-tenant';
UPDATE "subscriptions" SET "tenant_id" = 'default-tenant';
UPDATE "devices" SET "tenant_id" = 'default-tenant';
UPDATE "voucher_batches" SET "tenant_id" = 'default-tenant';
UPDATE "vouchers" SET "tenant_id" = 'default-tenant';
UPDATE "payments" SET "tenant_id" = 'default-tenant';
UPDATE "audit_logs" SET "tenant_id" = 'default-tenant';
-- Les SUPER_ADMIN restent hors exploitant (tenant_id NULL) ; les autres
-- comptes existants rejoignent l'exploitant repris.
UPDATE "admin_users" SET "tenant_id" = 'default-tenant' WHERE "role" <> 'SUPER_ADMIN';

ALTER TABLE "routers" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "plans" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "subscriptions" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "devices" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "voucher_batches" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "vouchers" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "payments" ALTER COLUMN "tenant_id" SET NOT NULL;

-- 5. Unicité désormais relative à l'exploitant --------------------------------

DROP INDEX "customers_phone_key";
DROP INDEX "payments_method_reference_key";
DROP INDEX "plans_mikrotik_profile_name_key";
DROP INDEX "plans_name_key";

CREATE UNIQUE INDEX "customers_tenant_id_phone_key" ON "customers"("tenant_id", "phone");
CREATE UNIQUE INDEX "payments_tenant_id_method_reference_key" ON "payments"("tenant_id", "method", "reference");
CREATE UNIQUE INDEX "plans_tenant_id_name_key" ON "plans"("tenant_id", "name");
CREATE UNIQUE INDEX "plans_tenant_id_mikrotik_profile_name_key" ON "plans"("tenant_id", "mikrotik_profile_name");

-- 6. Clés étrangères ----------------------------------------------------------

ALTER TABLE "mobile_money_accounts" ADD CONSTRAINT "mobile_money_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "routers" ADD CONSTRAINT "routers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
