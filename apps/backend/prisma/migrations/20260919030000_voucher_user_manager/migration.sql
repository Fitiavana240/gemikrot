-- Rattache un ticket à son compte User Manager.
--
-- Écrite à la main, comme les précédentes.
--
-- `um_username` reste NULL sur toutes les lignes existantes : les tickets
-- déjà vendus continuent d'être servis par le HotSpot local, et c'est cette
-- colonne qui distingue les deux générations. Aucune donnée n'est réécrite.

ALTER TABLE "vouchers" ADD COLUMN "um_username" TEXT;
ALTER TABLE "vouchers" ADD COLUMN "um_state" TEXT;
ALTER TABLE "vouchers" ADD COLUMN "last_reconciled_at" TIMESTAMP(3);

CREATE INDEX "vouchers_um_username_idx" ON "vouchers"("um_username");
