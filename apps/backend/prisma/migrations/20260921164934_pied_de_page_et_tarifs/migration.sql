-- AlterTable
ALTER TABLE "hotspot_login_pages" ADD COLUMN     "adresse" TEXT,
ADD COLUMN     "afficher_tarifs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reseau_social" TEXT,
ADD COLUMN     "telephones" TEXT;
