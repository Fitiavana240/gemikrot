-- CreateTable
CREATE TABLE "notifications_lues" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_lues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_lues_admin_user_id_cle_key" ON "notifications_lues"("admin_user_id", "cle");

-- AddForeignKey
ALTER TABLE "notifications_lues" ADD CONSTRAINT "notifications_lues_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
