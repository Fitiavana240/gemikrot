-- File des écritures vers le routeur qui n'ont pas pu partir.
-- Écrite à la main, comme les précédentes.
--
-- Elle existe pour un cas précis : un ticket expire pendant que le lien est
-- coupé. Sans file, la coupure d'accès est perdue et le client continue de
-- naviguer avec un ticket périmé. Toutes les opérations stockées ici sont
-- rejouables sans dommage — couper deux fois un accès déjà coupé n'a aucun
-- effet de bord.

CREATE TYPE "RouterOperationStatus" AS ENUM ('EN_ATTENTE', 'TERMINEE', 'ABANDONNEE');

CREATE TABLE "router_operations" (
  "id"           TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "router_id"    TEXT NOT NULL,
  "kind"         TEXT NOT NULL,
  "payload"      JSONB NOT NULL,
  "status"       "RouterOperationStatus" NOT NULL DEFAULT 'EN_ATTENTE',
  "attempts"     INTEGER NOT NULL DEFAULT 0,
  "last_error"   TEXT,
  "reason"       TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),

  CONSTRAINT "router_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "router_operations_router_id_status_idx" ON "router_operations"("router_id", "status");
CREATE INDEX "router_operations_tenant_id_idx" ON "router_operations"("tenant_id");

ALTER TABLE "router_operations"
  ADD CONSTRAINT "router_operations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "router_operations"
  ADD CONSTRAINT "router_operations_router_id_fkey"
  FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
