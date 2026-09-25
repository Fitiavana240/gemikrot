#!/usr/bin/env bash
#
# Éprouver une migration sur une copie, avant qu'elle touche les vraies données.
#
#   sudo bash deploiement/eprouver-la-migration.sh
#
# Le conteneur de migration doit réussir avant que le serveur démarre. Une
# migration fautive ne se contente donc pas d'échouer : **elle laisse la
# plateforme éteinte**, et l'on découvre le défaut au pire moment, sur la
# seule base qui compte.
#
# Ce script prend une copie de la base, y applique les migrations, et dit ce
# qui se passe. Il ne touche jamais à la base de production : il la lit.
#
# À lancer avant chaque déploiement qui porte une migration — c'est-à-dire
# chaque fois que `prisma/migrations` a gagné un dossier.
set -euo pipefail

RACINE=${RACINE:-/opt/gemikrot}
REGLAGES="$RACINE/.env.production"
COMPOSE="docker compose --env-file $REGLAGES -f $RACINE/deploiement/docker-compose.prod.yml"
ESSAI=gemikrot_essai

if [ ! -f "$REGLAGES" ]; then
  echo "Réglages introuvables : $REGLAGES" >&2
  exit 1
fi

# shellcheck disable=SC1090
UTILISATEUR=$(grep '^POSTGRES_USER=' "$REGLAGES" | cut -d= -f2)
MOT_DE_PASSE=$(grep '^POSTGRES_PASSWORD=' "$REGLAGES" | cut -d= -f2)
BASE=$(grep '^POSTGRES_DB=' "$REGLAGES" | cut -d= -f2)
BASE=${BASE:-gemikrot}

echo "════════════════════════════════════════════════════════"
echo " Épreuve de migration — sur une copie de « $BASE »"
echo "════════════════════════════════════════════════════════"

# 1. Une base jetable, refaite à chaque passage.
#
# `DROP` d'abord : un essai précédent interrompu laisserait une base à
# moitié migrée, sur laquelle l'épreuve dirait n'importe quoi.
echo
echo "── 1/3 · La copie"
$COMPOSE exec -T postgres psql -U "$UTILISATEUR" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $ESSAI" \
  -c "CREATE DATABASE $ESSAI"

# Les vraies données, et non un schéma vide : c'est précisément sur des
# lignes existantes qu'une migration se casse — une colonne passée en NOT
# NULL, une contrainte qu'un enregistrement ancien ne respecte pas.
$COMPOSE exec -T postgres sh -c \
  "pg_dump -U $UTILISATEUR $BASE | psql -q -U $UTILISATEUR -d $ESSAI" >/dev/null
LIGNES=$($COMPOSE exec -T postgres psql -U "$UTILISATEUR" -d "$ESSAI" -tAc \
  "select count(*) from routers")
echo "   Copie prête — $LIGNES routeur(s) dedans."

# 2. Les migrations, sur la copie.
echo
echo "── 2/3 · Les migrations"
if $COMPOSE run --rm --no-deps \
  -e "DATABASE_URL=postgresql://$UTILISATEUR:$MOT_DE_PASSE@postgres:5432/$ESSAI?schema=public" \
  migrate 2>&1 | sed 's/^/   /'; then
  VERDICT=ok
else
  VERDICT=echec
fi

# 3. Ce que la copie dit d'elle-même.
echo
echo "── 3/3 · Le verdict"
if [ "$VERDICT" = ok ]; then
  echo "   ✓ Les migrations passent sur vos vraies données."
  echo "     Le déploiement peut suivre."
else
  echo "   ✗ Les migrations ÉCHOUENT sur vos vraies données."
  echo "     **Ne déployez pas.** La base de production est intacte :"
  echo "     ce script ne l'a que lue."
fi

# La copie ne survit pas à l'épreuve : la garder ferait douter, un jour, de
# laquelle est la vraie.
$COMPOSE exec -T postgres psql -U "$UTILISATEUR" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $ESSAI"
echo
echo "════════════════════════════════════════════════════════"

[ "$VERDICT" = ok ]
