-- Le numero de serie de la carte, seule chose stable qu'un routeur dise de
-- lui-meme.
--
-- Son nom se change, et sa cle publique WireGuard est refaite a chaque
-- execution du script de raccordement : rejouer ce script creait donc une
-- fiche de plus a chaque fois, sans qu'aucune ne dise laquelle etait vivante.
-- Vu trois fois sur le meme appareil, le 24/09/2026.
ALTER TABLE "routers" ADD COLUMN "serial_number" TEXT;

-- Un appareil, une fiche. Les numeros nuls restent distincts pour PostgreSQL :
-- deux machines sans carte RouterBOARD -- CHR, x86 -- ne se genent pas.
CREATE UNIQUE INDEX "routers_tenant_id_serial_number_key" ON "routers"("tenant_id", "serial_number");
