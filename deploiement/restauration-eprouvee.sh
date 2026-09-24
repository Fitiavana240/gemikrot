#!/usr/bin/env bash
#
# GeMikrot — la restauration, éprouvée pour de vrai.
#
#   ./deploiement/restauration-eprouvee.sh /var/backups/gemikrot/gemikrot-20260924-020000.dump.age
#
# **Une sauvegarde jamais restaurée n'est pas une sauvegarde.** Elle n'est
# qu'un fichier dont on suppose le contenu — et la supposition ne se vérifie
# que le jour où l'on n'a plus rien d'autre.
#
# Ce script restaure dans une base jetable, à côté de la vraie, et compte ce
# qu'il y trouve. Il ne touche jamais la base de production : le nom de la
# base restaurée est tiré de l'horodatage, et elle est supprimée à la fin.
#
# À lancer une fois par mois. Le mettre dans cron sans jamais en lire la
# sortie ne vaudrait rien : c'est un exercice, et il demande un lecteur.

set -euo pipefail

ARCHIVE="${1:?usage : restauration-eprouvee.sh <fichier .dump.age>}"
RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$RACINE/deploiement/docker-compose.prod.yml"
UTILISATEUR="${POSTGRES_USER:-gemikrot}"
BASE_ESSAI="essai_restauration_$(date +%Y%m%d%H%M%S)"
# La clé privée `age`, apportée pour l'exercice et repartie avec. La laisser
# sur le serveur reviendrait à y laisser de quoi déchiffrer les sauvegardes.
IDENTITE_AGE="${GEMIKROT_AGE_IDENTITY:?définir GEMIKROT_AGE_IDENTITY — le fichier de clé privée age}"

nettoyer() {
  echo "— suppression de la base d'essai $BASE_ESSAI"
  docker compose -f "$COMPOSE" exec -T postgres \
    dropdb -U "$UTILISATEUR" --if-exists "$BASE_ESSAI" || true
}
# Même si l'exercice échoue en chemin : une base d'essai oubliée s'accumule,
# et la suivante bute sur un disque plein.
trap nettoyer EXIT

echo "— création de $BASE_ESSAI"
docker compose -f "$COMPOSE" exec -T postgres createdb -U "$UTILISATEUR" "$BASE_ESSAI"

echo "— déchiffrement et restauration"
age --decrypt --identity "$IDENTITE_AGE" "$ARCHIVE" \
  | docker compose -f "$COMPOSE" exec -T postgres \
      pg_restore -U "$UTILISATEUR" -d "$BASE_ESSAI" --no-owner --no-privileges

echo
echo "— ce que contient la sauvegarde"
docker compose -f "$COMPOSE" exec -T postgres \
  psql -U "$UTILISATEUR" -d "$BASE_ESSAI" -c "
    SELECT 'exploitants' AS quoi, count(*) FROM tenants
    UNION ALL SELECT 'comptes d''administration', count(*) FROM admin_users
    UNION ALL SELECT 'routeurs', count(*) FROM routers
    UNION ALL SELECT 'clients', count(*) FROM customers
    UNION ALL SELECT 'tickets', count(*) FROM vouchers
    UNION ALL SELECT 'paiements', count(*) FROM payments
    UNION ALL SELECT 'migrations appliquées', count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;"

echo
echo "— une migration interrompue rendrait la base inutilisable en silence"
docker compose -f "$COMPOSE" exec -T postgres \
  psql -U "$UTILISATEUR" -d "$BASE_ESSAI" -t -c "
    SELECT coalesce(string_agg(migration_name, ', '), 'aucune')
    FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;"

echo
echo "Exercice terminé. Lisez les nombres ci-dessus : ce sont eux la preuve,"
echo "pas le fait que le script se soit terminé sans erreur."
