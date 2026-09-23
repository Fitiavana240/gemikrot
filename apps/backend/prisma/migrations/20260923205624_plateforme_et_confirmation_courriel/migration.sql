-- DropForeignKey
ALTER TABLE "courriels" DROP CONSTRAINT "courriels_tenant_id_fkey";

-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "email_code" TEXT,
ADD COLUMN     "email_code_sent_at" TIMESTAMP(3),
ADD COLUMN     "email_verified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "courriels" ALTER COLUMN "tenant_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "plateforme" (
    "id" TEXT NOT NULL DEFAULT 'plateforme',
    "nom" TEXT NOT NULL DEFAULT 'GeMikrot',
    "smtp_host" TEXT,
    "smtp_port" INTEGER,
    "smtp_secure" BOOLEAN NOT NULL DEFAULT false,
    "smtp_user" TEXT,
    "smtp_password_encrypted" TEXT,
    "smtp_from" TEXT,
    "smtp_actif" BOOLEAN NOT NULL DEFAULT false,
    "contact_telephone" TEXT,
    "contact_whatsapp" TEXT,
    "contact_courriel" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plateforme_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courriels_created_at_idx" ON "courriels"("created_at");

-- AddForeignKey
ALTER TABLE "courriels" ADD CONSTRAINT "courriels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
