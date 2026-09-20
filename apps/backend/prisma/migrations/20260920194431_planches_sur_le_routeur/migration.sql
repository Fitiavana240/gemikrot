-- AlterTable
ALTER TABLE "voucher_batches" ADD COLUMN     "planches" TEXT[] DEFAULT ARRAY[]::TEXT[];
