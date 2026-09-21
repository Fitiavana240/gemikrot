-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_tenant_id_voucher_id_fkey";

-- AlterTable
ALTER TABLE "vouchers" ADD COLUMN     "expired_at" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_voucher_id_fkey" FOREIGN KEY ("tenant_id", "voucher_id") REFERENCES "vouchers"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
