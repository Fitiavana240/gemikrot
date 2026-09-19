-- Modèle d'impression des tickets, propre à chaque exploitant.
-- Écrite à la main, comme les précédentes.

CREATE TABLE "ticket_templates" (
  "id"         TEXT NOT NULL,
  "tenant_id"  TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "html"       TEXT NOT NULL,
  "per_page"   INTEGER NOT NULL DEFAULT 30,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ticket_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_templates_tenant_id_name_key" ON "ticket_templates"("tenant_id", "name");
CREATE INDEX "ticket_templates_tenant_id_idx" ON "ticket_templates"("tenant_id");

ALTER TABLE "ticket_templates"
  ADD CONSTRAINT "ticket_templates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
