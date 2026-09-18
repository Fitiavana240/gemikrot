/*
  Warnings:

  - You are about to drop the column `device_type` on the `devices` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PlanKind" AS ENUM ('TICKET', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('PHONE', 'COMPUTER', 'TV', 'CAMERA', 'ROUTER', 'OTHER');

-- AlterTable
ALTER TABLE "devices" DROP COLUMN "device_type",
ADD COLUMN     "bypass_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "detected_type" "DeviceType",
ADD COLUMN     "detection_source" TEXT,
ADD COLUMN     "mikrotik_binding_id" TEXT,
ADD COLUMN     "router_id" TEXT,
ADD COLUMN     "subscription_id" TEXT,
ADD COLUMN     "type" "DeviceType" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "subscription_id" TEXT;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "kind" "PlanKind" NOT NULL DEFAULT 'TICKET',
ADD COLUMN     "price_needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "session_timeout_seconds" INTEGER,
ADD COLUMN     "subscription_period_days" INTEGER;

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "router_id" TEXT NOT NULL,
    "hotspot_username" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "grace_ends_at" TIMESTAMP(3) NOT NULL,
    "suspended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_current_period_end_idx" ON "subscriptions"("current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_router_id_hotspot_username_key" ON "subscriptions"("router_id", "hotspot_username");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_router_id_fkey" FOREIGN KEY ("router_id") REFERENCES "routers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
