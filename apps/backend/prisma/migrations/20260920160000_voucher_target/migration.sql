-- Où vit le compte qui sert un ticket.
--
-- Jusqu'ici, `um_username IS NULL` voulait dire deux choses à la fois :
-- « ticket historique sans compte » et « servi par le HotSpot ». Tant que
-- les lots n'étaient générés que sur User Manager, la confusion restait sans
-- conséquence. Elle en aurait une dès qu'un lot HotSpot est pré-créé : la
-- vente essaierait de créer un compte qui existe déjà.
CREATE TYPE "VoucherTarget" AS ENUM ('USER_MANAGER', 'HOTSPOT');

ALTER TABLE "vouchers" ADD COLUMN "target" "VoucherTarget";
ALTER TABLE "voucher_batches" ADD COLUMN "target" "VoucherTarget";

-- Rétroactif : un ticket qui porte un compte User Manager en vient. Ceux qui
-- n'en portent pas restent à NULL — ce sont les historiques, et leur compte
-- continue d'être créé à la vente.
UPDATE "vouchers" SET "target" = 'USER_MANAGER' WHERE "um_username" IS NOT NULL;

-- Un lot dont au moins un ticket est sur User Manager l'est tout entier :
-- la génération n'a jamais mélangé les deux.
UPDATE "voucher_batches" b SET "target" = 'USER_MANAGER'
WHERE EXISTS (
  SELECT 1 FROM "vouchers" v WHERE v."batch_id" = b."id" AND v."um_username" IS NOT NULL
);
