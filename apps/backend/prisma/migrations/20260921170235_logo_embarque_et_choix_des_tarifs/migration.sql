-- AlterTable
ALTER TABLE "hotspot_login_pages" ADD COLUMN     "tarifs_masques" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "titre_tarifs" TEXT;
