-- Verrous des travaux planifiés.
--
-- Une table plutôt qu'un verrou consultatif : le travail dure des minutes et
-- traverse plusieurs connexions du pool, là où un verrou consultatif exige de
-- garder la même connexion. Et l'état reste lisible — un verrou coincé se voit.
--
-- `locked_until` fait expirer le verrou de lui-même : un processus tué ne
-- bloque pas le parc jusqu'au prochain redémarrage.

CREATE TABLE "job_locks" (
  "name" TEXT NOT NULL,
  "locked_until" TIMESTAMP(3) NOT NULL,
  "holder" TEXT NOT NULL,
  "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "job_locks_pkey" PRIMARY KEY ("name")
);
