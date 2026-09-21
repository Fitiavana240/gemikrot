-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "max_routers" INTEGER,
ADD COLUMN     "platform_ends_at" TIMESTAMP(3),
ADD COLUMN     "platform_grace_ends_at" TIMESTAMP(3),
ADD COLUMN     "platform_plan_name" TEXT;
