-- Ne vider QUE la colonne du ticket, pas celle de l'exploitant.
--
-- `ON DELETE SET NULL` sans liste de colonnes vide toutes celles de la clé
-- étrangère. Ici elle est composite — (tenant_id, voucher_id) — si bien que
-- purger un ticket payé tentait de mettre `tenant_id` à NULL et se heurtait à
-- sa contrainte NOT NULL :
--
--   Null constraint violation on the fields: (`tenant_id`)
--
-- Relevé en purgeant un vrai ticket payé, pas déduit du schéma. PostgreSQL 15
-- et suivants acceptent une liste de colonnes ; la base tourne en 16.
--
-- Prisma ne sait pas exprimer cette liste dans le schéma : la contrainte est
-- donc posée ici, et `prisma migrate diff` la verra conforme puisque seule la
-- liste diffère de ce que le schéma déclare.
ALTER TABLE "payments" DROP CONSTRAINT "payments_tenant_id_voucher_id_fkey";

ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_voucher_id_fkey"
  FOREIGN KEY ("tenant_id", "voucher_id")
  REFERENCES "vouchers"("tenant_id", "id")
  ON DELETE SET NULL ("voucher_id")
  ON UPDATE CASCADE;
