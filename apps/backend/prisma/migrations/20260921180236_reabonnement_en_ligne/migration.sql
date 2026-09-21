-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "renews_voucher_id" TEXT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_renews_voucher_id_fkey" FOREIGN KEY ("tenant_id", "renews_voucher_id") REFERENCES "vouchers"("tenant_id", "id") ON DELETE SET NULL ON UPDATE CASCADE;
