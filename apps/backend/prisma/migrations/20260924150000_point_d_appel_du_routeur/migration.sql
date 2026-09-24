-- L'adresse a laquelle le SERVEUR appelle le routeur, sous la forme `nom:port`.
--
-- Le montage d'origine etait l'inverse : le routeur appelait le serveur. C'est
-- le bon sens quand le serveur a une adresse publique et que les routeurs sont
-- derriere des NAT d'operateur. Il ne vaut plus des que le serveur lui-meme est
-- mobile -- un portable en partage de connexion n'a aucune adresse joignable,
-- et personne ne peut l'appeler.
ALTER TABLE "routers" ADD COLUMN "tunnel_endpoint" TEXT;
