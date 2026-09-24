#!/usr/bin/env bash
#
# GeMikrot — la sauvegarde nocturne.
#
# À lancer par cron sur le VPS :
#   0 2 * * * /opt/gemikrot/deploiement/sauvegarde.sh >> /var/log/gemikrot-sauvegarde.log 2>&1
#
# **Chiffrée, et déposée ailleurs.** Un dump en clair sur le disque du serveur
# protège d'un `DROP TABLE`, de rien d'autre : le jour où le VPS est perdu ou
# compromis, la sauvegarde l'est avec lui.
#
# **Les secrets ne sont PAS dedans**, et c'est délibéré. `ROUTER_CREDENTIALS_KEY`
# chiffre les identifiants des routeurs dans cette base ; le ranger à côté du
# dump annulerait exactement ce qu'il protège. Il se sauvegarde à part, une
# fois, à la main — voir `LISEZ-MOI.md`.

set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$RACINE/deploiement/docker-compose.prod.yml"
DESTINATION="${GEMIKROT_SAUVEGARDES:-/var/backups/gemikrot}"
# Clé publique `age`. La privée reste hors du serveur : une sauvegarde qu'on
# peut déchiffrer depuis la machine compromise n'est pas chiffrée.
DESTINATAIRE_AGE="${GEMIKROT_AGE_RECIPIENT:?définir GEMIKROT_AGE_RECIPIENT — la clé publique age}"
JOURS_CONSERVES="${GEMIKROT_RETENTION_JOURS:-30}"

horodatage="$(date +%Y%m%d-%H%M%S)"
fichier="$DESTINATION/gemikrot-$horodatage.dump.age"

mkdir -p "$DESTINATION"

# `-Fc` : le format personnalisé de Postgres. Il se restaure sélectivement,
# se compresse tout seul, et `pg_restore` sait en lire la table des matières
# sans tout dérouler — ce qui permet de vérifier un fichier sans restaurer.
#
# Le flux ne touche jamais le disque en clair : pg_dump écrit dans le tube,
# age chiffre, et seul le résultat est posé.
docker compose -f "$COMPOSE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-gemikrot}" -d "${POSTGRES_DB:-gemikrot}" -Fc \
  | age --recipient "$DESTINATAIRE_AGE" --output "$fichier"

taille="$(du -h "$fichier" | cut -f1)"
echo "$(date -Is) — sauvegarde écrite : $fichier ($taille)"

# Un dump anormalement petit est le signe d'une base vidée ou d'un dump
# interrompu. Mieux vaut crier maintenant que le découvrir à la restauration.
octets="$(stat -c %s "$fichier")"
if [ "$octets" -lt 10240 ]; then
  echo "ALERTE : la sauvegarde ne fait que $octets octets. Vérifier la base." >&2
  exit 1
fi

# La rotation vient après l'écriture réussie : effacer d'abord laisserait, un
# soir où le dump échoue, zéro sauvegarde au lieu d'une vieille.
find "$DESTINATION" -name 'gemikrot-*.dump.age' -mtime "+$JOURS_CONSERVES" -delete

# Le dépôt hors du serveur. `rclone` est le plus simple à tenir ; n'importe
# quel transfert fait l'affaire du moment qu'il sort de cette machine.
if [ -n "${GEMIKROT_DEPOT_DISTANT:-}" ]; then
  rclone copy "$fichier" "$GEMIKROT_DEPOT_DISTANT" \
    && echo "$(date -Is) — déposée sur $GEMIKROT_DEPOT_DISTANT"
else
  echo "AVERTISSEMENT : GEMIKROT_DEPOT_DISTANT n'est pas défini." >&2
  echo "La sauvegarde reste sur le serveur qu'elle est censée protéger." >&2
fi
