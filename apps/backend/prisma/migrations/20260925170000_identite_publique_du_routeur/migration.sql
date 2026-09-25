-- L'identite publique d'un routeur, et le routeur d'un paiement.
--
-- Toute la chaine commerciale -- offres, paiements, tickets -- ne portait que
-- l'exploitant. Sur un parc a un seul routeur cela ne se voit pas. Des qu'il y
-- en a deux, un client qui paie sur le site B recoit un ticket cree sur le
-- site A : `verifier` appelait `generateSingle(planId)` sans routeur, et le
-- repli est << le plus ancien routeur de l'exploitant >>. Le code ne marche
-- pas la ou le client se trouve, et rien n'explique pourquoi.

-- 1. Une identite publique, distincte de la cle primaire.
--
-- **L'uuid ne doit pas sortir.** Il apparaitrait dans l'adresse gravee sur la
-- page captive de chaque routeur, donc sur l'ecran de chaque client, donc
-- dans les journaux de tout ce qui passe entre les deux. Un identifiant court
-- et tire au hasard dit la meme chose sans rien reveler de la base.
ALTER TABLE "routers" ADD COLUMN "public_id" TEXT;

-- Les fiches existantes en recoivent une : sans cela, leur page captive ne
-- pourrait pas nommer son routeur, et il faudrait repasser sur chacune.
-- 12 caracteres de l'alphabet hexadecimal, sans separateur : assez pour ne
-- jamais se croiser, assez court pour tenir dans une adresse.
UPDATE "routers"
   SET "public_id" = substr(md5(random()::text || id), 1, 12)
 WHERE "public_id" IS NULL;

ALTER TABLE "routers" ALTER COLUMN "public_id" SET NOT NULL;

-- Unique sur tout le parc, et non par exploitant : cet identifiant sert a
-- resoudre un routeur **avant** de savoir a qui il appartient, puisqu'il
-- arrive d'un client qui n'est authentifie nulle part.
CREATE UNIQUE INDEX "routers_public_id_key" ON "routers"("public_id");

-- 2. Le routeur ou le paiement a eu lieu.
--
-- Nullable : les paiements deja enregistres n'en portent pas, et leur en
-- inventer un serait mentir sur une vente passee. Le code qui le lit doit
-- donc retomber sur le routeur par defaut, comme avant -- ce qui est exact
-- pour un parc a un routeur, c'est-a-dire pour tous ceux d'aujourd'hui.
ALTER TABLE "payments" ADD COLUMN "router_id" TEXT;

-- La cle etrangere est composite : une ligne enfant ne peut referencer que
-- des lignes du meme exploitant. Sans cela, la base accepterait un paiement
-- de A rattache a un routeur de B.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_tenant_id_router_id_fkey"
  FOREIGN KEY ("tenant_id", "router_id") REFERENCES "routers"("tenant_id", "id")
  -- RESTRICT et non SET NULL : la cle est composite, et `tenant_id` est NOT
  -- NULL -- SET NULL tenterait de l'annuler et echouerait a la suppression.
  -- C'est aussi la convention de toutes les autres cles vers `routers`, et
  -- elle s'accorde avec la console, qui refuse deja de supprimer un routeur
  -- portant des donnees.
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "payments_tenant_id_router_id_idx" ON "payments"("tenant_id", "router_id");
