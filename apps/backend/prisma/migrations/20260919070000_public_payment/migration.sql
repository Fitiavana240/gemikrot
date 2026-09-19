-- Page de paiement publique : identifiant d'exploitant dans l'URL, et suivi
-- d'une demande de paiement. Écrite à la main, comme les précédentes.

-- 1. Identifiant public de l'exploitant ------------------------------------
-- Ajouté sans contrainte, rempli, puis rendu obligatoire et unique : une
-- colonne NOT NULL posée d'emblée échouerait sur les lignes existantes.

ALTER TABLE "tenants" ADD COLUMN "slug" TEXT;

-- Dérivé du nom : minuscules, accents translittérés, tout le reste en tirets.
-- `translate` plutôt que `unaccent`, qui exigerait une extension Postgres.
UPDATE "tenants"
SET "slug" = trim(both '-' from regexp_replace(
  lower(translate("name", 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝ',
                          'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY')),
  '[^a-z0-9]+', '-', 'g'))
WHERE "slug" IS NULL;

-- Repli si la dérivation donne une chaîne vide (nom entièrement non latin).
UPDATE "tenants" SET "slug" = 'exploitant-' || left("id", 8) WHERE "slug" IS NULL OR "slug" = '';

-- Départage les collisions en suffixant l'identifiant.
UPDATE "tenants" t
SET "slug" = t."slug" || '-' || left(t."id", 4)
WHERE EXISTS (
  SELECT 1 FROM "tenants" o WHERE o."slug" = t."slug" AND o."id" <> t."id"
);

ALTER TABLE "tenants" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- 2. Suivi d'une demande de paiement ---------------------------------------

CREATE TABLE "payment_claims" (
  "id"         TEXT NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "payment_id" TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "phone"      TEXT NOT NULL,
  "reference"  TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payment_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_claims_payment_id_key" ON "payment_claims"("payment_id");
CREATE UNIQUE INDEX "payment_claims_token_key" ON "payment_claims"("token");
CREATE INDEX "payment_claims_tenant_id_phone_idx" ON "payment_claims"("tenant_id", "phone");

ALTER TABLE "payment_claims"
  ADD CONSTRAINT "payment_claims_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_claims"
  ADD CONSTRAINT "payment_claims_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
