-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "smtp_actif" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smtp_from" TEXT,
ADD COLUMN     "smtp_host" TEXT,
ADD COLUMN     "smtp_password_encrypted" TEXT,
ADD COLUMN     "smtp_port" INTEGER,
ADD COLUMN     "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smtp_user" TEXT;

-- CreateTable
CREATE TABLE "courriels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "destinataire" TEXT NOT NULL,
    "sujet" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "statut" TEXT NOT NULL,
    "erreur" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courriels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courriels_tenant_id_created_at_idx" ON "courriels"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "courriels" ADD CONSTRAINT "courriels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
