-- Enrôlement d'un routeur par tunnel WireGuard.
-- Écrite à la main : une migration générée proposerait aussi des suppressions
-- de colonnes sans rapport, déjà constaté sur ce schéma.

ALTER TABLE "routers"
  ADD COLUMN "tunnel_address" TEXT,
  ADD COLUMN "tunnel_public_key" TEXT,
  ADD COLUMN "enrolled_at" TIMESTAMP(3);

-- Une adresse du tunnel n'appartient qu'à un routeur, tous exploitants
-- confondus : le plan d'adressage est commun, contrairement aux données.
CREATE UNIQUE INDEX "routers_tunnel_address_key" ON "routers"("tunnel_address");

CREATE TABLE "router_enrollments" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "tunnel_address" TEXT NOT NULL,
  "credentials_encrypted" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "router_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "router_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "router_enrollments_token_hash_key" ON "router_enrollments"("token_hash");
CREATE UNIQUE INDEX "router_enrollments_tunnel_address_key" ON "router_enrollments"("tunnel_address");
CREATE UNIQUE INDEX "router_enrollments_router_id_key" ON "router_enrollments"("router_id");

ALTER TABLE "router_enrollments"
  ADD CONSTRAINT "router_enrollments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "router_enrollments"
  ADD CONSTRAINT "router_enrollments_router_id_fkey"
  FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
