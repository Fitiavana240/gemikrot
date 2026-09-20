-- Descend le cloisonnement dans la base.
--
-- L'extension Prisma est un bon filet, mais elle ne protège que le code qui
-- pense à passer par le client cloisonné. La fuite corrigée à l'import de
-- routeur l'a montré : un service qui utilise le client brut échappe à tout.
-- Ici, c'est PostgreSQL qui refuse, quel que soit le code appelant.
--
-- Chaque relation entre deux modèles cloisonnés devient composite : une ligne
-- ne peut plus référencer que des lignes du MÊME exploitant. Jusqu'ici la base
-- acceptait volontiers un paiement de A rattaché à un client de B.
--
-- Les clés simples sont remplacées, pas doublées : deux contraintes sur la
-- même colonne coûteraient une vérification de plus à chaque écriture sans
-- rien garantir de plus.
--
-- La sémantique ON DELETE est reprise à l'identique (RESTRICT partout, sauf
-- CASCADE sur payment_claims et router_operations).
--
-- PostgreSQL refusera d'ajouter une contrainte que des lignes existantes
-- violent. Contrôle passé sur la base de développement avant écriture : les
-- 19 relations, zéro ligne inter-exploitants. Sur un autre environnement, un
-- échec ici signale des données à réparer, pas une migration à forcer.

-- DropForeignKey
ALTER TABLE "devices" DROP CONSTRAINT "devices_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "devices" DROP CONSTRAINT "devices_router_id_fkey";

-- DropForeignKey
ALTER TABLE "devices" DROP CONSTRAINT "devices_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "payment_claims" DROP CONSTRAINT "payment_claims_payment_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_voucher_id_fkey";

-- DropForeignKey
ALTER TABLE "router_enrollments" DROP CONSTRAINT "router_enrollments_router_id_fkey";

-- DropForeignKey
ALTER TABLE "router_operations" DROP CONSTRAINT "router_operations_router_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_router_id_fkey";

-- DropForeignKey
ALTER TABLE "voucher_batches" DROP CONSTRAINT "voucher_batches_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "voucher_batches" DROP CONSTRAINT "voucher_batches_router_id_fkey";

-- DropForeignKey
ALTER TABLE "vouchers" DROP CONSTRAINT "vouchers_batch_id_fkey";

-- DropForeignKey
ALTER TABLE "vouchers" DROP CONSTRAINT "vouchers_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "vouchers" DROP CONSTRAINT "vouchers_device_id_fkey";

-- DropForeignKey
ALTER TABLE "vouchers" DROP CONSTRAINT "vouchers_plan_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_tenant_id_id_key" ON "devices"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_claims_tenant_id_payment_id_key" ON "payment_claims"("tenant_id", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_id_key" ON "payments"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenant_id_voucher_id_key" ON "payments"("tenant_id", "voucher_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_tenant_id_id_key" ON "plans"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "router_enrollments_tenant_id_router_id_key" ON "router_enrollments"("tenant_id", "router_id");

-- CreateIndex
CREATE UNIQUE INDEX "routers_tenant_id_id_key" ON "routers"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_tenant_id_id_key" ON "subscriptions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_batches_tenant_id_id_key" ON "voucher_batches"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "vouchers_tenant_id_id_key" ON "vouchers"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_router_id_fkey" FOREIGN KEY ("tenant_id", "router_id") REFERENCES "routers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_router_id_fkey" FOREIGN KEY ("tenant_id", "router_id") REFERENCES "routers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_subscription_id_fkey" FOREIGN KEY ("tenant_id", "subscription_id") REFERENCES "subscriptions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_tenant_id_router_id_fkey" FOREIGN KEY ("tenant_id", "router_id") REFERENCES "routers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_batches" ADD CONSTRAINT "voucher_batches_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenant_id_batch_id_fkey" FOREIGN KEY ("tenant_id", "batch_id") REFERENCES "voucher_batches"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_tenant_id_device_id_fkey" FOREIGN KEY ("tenant_id", "device_id") REFERENCES "devices"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "plans"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_voucher_id_fkey" FOREIGN KEY ("tenant_id", "voucher_id") REFERENCES "vouchers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_subscription_id_fkey" FOREIGN KEY ("tenant_id", "subscription_id") REFERENCES "subscriptions"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_claims" ADD CONSTRAINT "payment_claims_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payments"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "router_operations" ADD CONSTRAINT "router_operations_tenant_id_router_id_fkey" FOREIGN KEY ("tenant_id", "router_id") REFERENCES "routers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "router_enrollments" ADD CONSTRAINT "router_enrollments_tenant_id_router_id_fkey" FOREIGN KEY ("tenant_id", "router_id") REFERENCES "routers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

