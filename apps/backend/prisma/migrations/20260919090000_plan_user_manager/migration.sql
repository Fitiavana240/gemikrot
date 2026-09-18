-- Rattache une offre à son profil User Manager et à sa limitation.
--
-- Écrite à la main : la migration générée pour le multi-locataires avait
-- proposé de supprimer les colonnes de prix au lieu de les renommer, et la
-- confiance ne s'est pas rétablie depuis.
--
-- Aucun backfill, aucune écriture sur le routeur : les offres existantes
-- gardent `um_profile_name` à NULL tant qu'elles n'ont pas été réconciliées,
-- et continuent d'être servies par leur profil HotSpot historique.

ALTER TABLE "plans" ADD COLUMN "um_profile_name" TEXT;
ALTER TABLE "plans" ADD COLUMN "um_limitation_name" TEXT;
ALTER TABLE "plans" ADD COLUMN "um_synced_at" TIMESTAMP(3);

-- Un index unique PostgreSQL tolère plusieurs NULL : les offres non encore
-- réconciliées ne se gênent donc pas entre elles.
CREATE UNIQUE INDEX "plans_tenant_id_um_profile_name_key"
  ON "plans"("tenant_id", "um_profile_name");
