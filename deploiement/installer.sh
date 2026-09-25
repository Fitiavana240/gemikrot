#!/usr/bin/env bash
#
# GeMikrot — installation complète sur un serveur neuf.
#
# À coller dans la console du VPS, en une fois :
#
#   curl -fsSL https://raw.githubusercontent.com/<compte>/<depot>/main/deploiement/installer.sh | bash -s -- <depot-git> <nom-public>
#
# Exemple :
#   ... | bash -s -- https://github.com/Fitiavana240/gemikrot.git gemikrot.duckdns.org
#
# **Rejouable.** Relancé, il met à jour le code et redémarre sans rien perdre :
# ni la base, ni les secrets déjà tirés, ni la clé du tunnel. C'est la
# propriété qui compte le plus ici — on relance un installateur quand on croit
# que quelque chose a raté, et c'est exactement là qu'un script destructeur
# fait le plus de dégâts.

set -euo pipefail

DEPOT="${1:?usage : installer.sh <depot-git> <nom-public>}"
DOMAINE_PUBLIC="${2:?usage : installer.sh <depot-git> <nom-public>}"
RACINE=/opt/gemikrot
PORT_TUNNEL=41820

if [ "$(id -u)" -ne 0 ]; then
  echo "À lancer en root : sudo bash installer.sh …" >&2
  exit 1
fi

echo "════════════════════════════════════════════════════════"
echo " GeMikrot — installation sur $DOMAINE_PUBLIC"
echo "════════════════════════════════════════════════════════"

# ─────────────────────────────────────────────────── 1. Docker et WireGuard
#
# Le dépôt officiel de Docker plutôt que celui d'Ubuntu : la version d'Ubuntu
# est souvent trop ancienne pour `docker compose` en sous-commande, et l'on
# s'en aperçoit à la dernière étape, quand tout le reste est déjà posé.
echo
echo "── 1/6 · Docker et WireGuard"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi
apt-get install -y -qq wireguard-tools git >/dev/null
echo "   Docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1), WireGuard prêts."

# ─────────────────────────────────────────────────────────── 2. Le code
echo
echo "── 2/6 · Le code"
if [ -d "$RACINE/.git" ]; then
  git -C "$RACINE" fetch --quiet origin
  git -C "$RACINE" reset --hard --quiet origin/main
  echo "   Mis à jour depuis $DEPOT"
else
  git clone --quiet "$DEPOT" "$RACINE"
  echo "   Récupéré dans $RACINE"
fi

# ──────────────────────────────────────────────────────── 3. Les secrets
#
# **Tirés une seule fois.** Les retirer à chaque exécution rendrait illisibles
# les identifiants de tous les routeurs déjà raccordés — il faudrait retourner
# sur place, un par un. Le fichier existant fait donc autorité.
echo
echo "── 3/6 · Les secrets"
REGLAGES="$RACINE/.env.production"
if [ -f "$REGLAGES" ]; then
  echo "   Déjà présents, conservés."
  # **Une exception : l'adresse de rappel.**
  #
  # Caddy ne transmet au serveur que ce qui commence par « /api » ; le reste
  # va à la console, qui refuse un POST par « 405 Method Not Allowed ». Les
  # premières installations écrivaient l'adresse sans ce préfixe, et le
  # routeur lisait ce 405 après un script entièrement déroulé.
  #
  # Les secrets, eux, restent intouchés : les retirer rendrait illisibles les
  # identifiants de tous les routeurs déjà raccordés.
  if grep -q "^PUBLIC_BASE_URL=.*[^i]$" "$REGLAGES" && ! grep -q "^PUBLIC_BASE_URL=.*/api$" "$REGLAGES"; then
    sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://$DOMAINE_PUBLIC/api|" "$REGLAGES"
    echo "   Adresse de rappel corrigée : elle passe désormais par /api."
    # Docker ne recrée pas toujours un conteneur quand seul le contenu du
    # fichier de réglages change : le serveur garderait l'ancienne adresse, et
    # les scripts qu'il produit enverraient les routeurs au mauvais endroit.
    RECREER=oui
  fi
  # **Et le chemin du fichier de pairs.**
  #
  # Il visait `wg0.conf`, que le conteneur ne peut pas ecrire : ce fichier
  # porte la cle privee du serveur et n'appartient qu'a root. La console
  # annoncait << Le serveur n'a pas pu ecrire le fichier du tunnel >> et le
  # raccordement s'arretait la.
  if grep -q '^WIREGUARD_CONFIG_PATH=.*wg0\.conf$' "$REGLAGES"; then
    sed -i 's|^WIREGUARD_CONFIG_PATH=.*|WIREGUARD_CONFIG_PATH=/etc/wireguard/pairs.conf|' "$REGLAGES"
    echo "   Chemin du fichier de pairs corrigé : la console peut désormais l'écrire."
    RECREER=oui
  fi
else
  cat > "$REGLAGES" <<FIN
POSTGRES_USER=gemikrot
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=gemikrot
DOMAINE=$DOMAINE_PUBLIC
ROUTER_CREDENTIALS_KEY=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
JWT_EXPIRES_IN=12h
WIREGUARD_ENDPOINT_HOST=$DOMAINE_PUBLIC
WIREGUARD_ENDPOINT_PORT=$PORT_TUNNEL
WIREGUARD_SUBNET=10.88.0.0/16
WIREGUARD_SERVER_ADDRESS=10.88.0.1
WIREGUARD_INTERFACE=wg0
WIREGUARD_MANAGED=false
WIREGUARD_CONFIG_PATH=/etc/wireguard/pairs.conf
PUBLIC_BASE_URL=https://$DOMAINE_PUBLIC/api
SCHEDULER_ENABLED=true
SEED_ADMIN_EMAIL=gemikrot@gmail.com
SEED_ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
FIN
  chmod 600 "$REGLAGES"
  echo "   Tirés et enregistrés dans $REGLAGES (lisible du seul root)."
fi

# ────────────────────────────────────────────────────────── 4. Le tunnel
#
# **Trois fichiers, et non un.** La console doit pouvoir ecrire les pairs ;
# elle tourne dans un conteneur, sous un utilisateur sans droits. Lui ouvrir
# `wg0.conf` aurait marche -- et lui aurait donne la cle privee du serveur par
# la meme occasion, puisqu'elle y figure.
#
#   interface.conf   la cle privee. root seul, jamais montee dans le conteneur
#   pairs.conf       les pairs. Ecrit par la console, monte chez elle
#   wg0.conf         assemble par systemd des que pairs.conf change
#
# La perdre obligerait a raccorder de nouveau chaque routeur, sur place.
echo
echo "── 4/6 · Le tunnel"
mkdir -p /etc/wireguard

# L'utilisateur du conteneur. L'image `node` le numerote 1000, et c'est lui
# qui doit pouvoir ecrire les pairs.
UID_CONTENEUR=1000

if [ ! -f /etc/wireguard/serveur.cle ]; then
  (umask 077; wg genkey > /etc/wireguard/serveur.cle)
  wg pubkey < /etc/wireguard/serveur.cle > /etc/wireguard/serveur.pub
  echo "   Clé du serveur produite."
else
  echo "   Clé du serveur déjà présente, conservée."
fi
CLE_PUBLIQUE=$(cat /etc/wireguard/serveur.pub)

# L'interface, avec la cle. Refaite a chaque passage : elle ne contient rien
# qu'on ne puisse reconstruire, et la cle vient du fichier conserve ci-dessus.
cat > /etc/wireguard/interface.conf <<FIN
# GeMikrot — bout serveur du tunnel.
#
# **Ne pas modifier wg0.conf à la main** : il est réassemblé à partir de ce
# fichier et de pairs.conf dès que la console écrit un pair.

[Interface]
PrivateKey = $(cat /etc/wireguard/serveur.cle)
# /16 et non /32 : c'est cette adresse qui crée la route vers tout le
# sous-réseau du tunnel. En /32, le serveur saurait recevoir les appels des
# routeurs mais pas leur répondre.
Address = 10.88.0.1/16
ListenPort = $PORT_TUNNEL
FIN
chmod 600 /etc/wireguard/interface.conf

# Les pairs. **Recuperes de wg0.conf s'ils y sont deja** : une installation
# anterieure les y a peut-etre ecrits, et les perdre couperait des routeurs
# qui fonctionnent.
if [ ! -f /etc/wireguard/pairs.conf ]; then
  if [ -f /etc/wireguard/wg0.conf ] && grep -q '^\[Peer\]' /etc/wireguard/wg0.conf; then
    sed -n '/^\[Peer\]/,$p' /etc/wireguard/wg0.conf > /etc/wireguard/pairs.conf
    echo "   Pairs existants récupérés depuis wg0.conf."
  else
    printf '%s\n' '# Les pairs, écrits par la console après chaque raccordement.' \
      > /etc/wireguard/pairs.conf
  fi
fi

# Le conteneur doit pouvoir ecrire ce fichier, et seulement celui-la.
chown "root:$UID_CONTENEUR" /etc/wireguard/pairs.conf
chmod 660 /etc/wireguard/pairs.conf
# Et traverser le dossier pour l'atteindre, sans pouvoir le lister en entier.
chmod 710 /etc/wireguard
chown "root:$UID_CONTENEUR" /etc/wireguard

cat /etc/wireguard/interface.conf /etc/wireguard/pairs.conf > /etc/wireguard/wg0.conf
chmod 600 /etc/wireguard/wg0.conf

systemctl enable --now wg-quick@wg0 >/dev/null 2>&1 || systemctl restart wg-quick@wg0

# **L'observateur.** La console ecrit `pairs.conf` ; sans lui il faudrait
# recharger le tunnel a la main apres chaque raccordement.
#
# `syncconf` et non `down/up` : il applique les pairs sans couper l'interface,
# donc sans faire tomber les routeurs deja connectes.
cat > /etc/systemd/system/gemikrot-tunnel.path <<'FIN'
[Unit]
Description=Surveille pairs.conf et applique les pairs que la console y écrit

[Path]
PathChanged=/etc/wireguard/pairs.conf

[Install]
WantedBy=multi-user.target
FIN
cat > /etc/systemd/system/gemikrot-tunnel.service <<'FIN'
[Unit]
Description=Réassemble wg0.conf et applique les pairs sans couper le tunnel

[Service]
Type=oneshot
# **bash et non sh.** La substitution de processus `<(...)` n'existe pas dans
# `dash`, qui est le `/bin/sh` d'Ubuntu : le service echouait sans bruit, la
# console ecrivait bien les pairs, et le tunnel ne les voyait jamais.
ExecStart=/bin/bash -c 'cat /etc/wireguard/interface.conf /etc/wireguard/pairs.conf > /etc/wireguard/wg0.conf && wg syncconf wg0 <(wg-quick strip wg0)'
FIN
systemctl daemon-reload
systemctl enable --now gemikrot-tunnel.path >/dev/null 2>&1
echo "   Tunnel actif, et les pairs s'appliqueront tout seuls."

# ──────────────────────────────────────────────────────── 5. Le pare-feu
#
# OVH ne filtre rien par défaut, mais la machine peut porter un ufw actif
# selon l'image. On ouvre explicitement plutôt que de le supposer.
echo
echo "── 5/6 · Le pare-feu"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow "$PORT_TUNNEL"/udp >/dev/null
  echo "   80, 443 et $PORT_TUNNEL/udp ouverts."
else
  echo "   Aucun pare-feu actif : rien à ouvrir."
fi

# ───────────────────────────────────────────────────── 6. La plateforme
echo
echo "── 6/6 · La plateforme"
cd "$RACINE"
docker compose --env-file "$REGLAGES" -f deploiement/docker-compose.prod.yml up -d --build
if [ "${RECREER:-non}" = oui ]; then
  echo "   Redémarrage du serveur pour qu'il lise la nouvelle adresse…"
  docker compose --env-file "$REGLAGES" -f deploiement/docker-compose.prod.yml     up -d --force-recreate backend
fi

# Le compte d'acces.
#
# **Sans cette etape, l'ecran de connexion refuse les identifiants que cet
# installateur vient d'afficher.** Le `seed` est une commande separee, et rien
# ne la lancait : on se retrouvait devant un refus sur des identifiants
# qu'on lisait a l'ecran. Le pire des messages, celui qui fait douter de ce
# qu'on a sous les yeux.
#
# Rejouable : le seed met a jour le compte s'il existe deja, sans toucher a
# l'exploitant ni a ses donnees.
echo "   Creation du compte d'acces..."
docker compose --env-file "$REGLAGES" -f deploiement/docker-compose.prod.yml \
  run --rm --no-deps backend npx tsx prisma/seed.ts

# L'epreuve qui manquait.
#
# Le routeur rappelle cette adresse a la fin de son script. Si le relais est
# mal reglé, il lit « Status 405 » -- apres avoir tout pose sur son materiel,
# et sans rien qui explique pourquoi. Le verifier ici coute deux secondes et
# evite de le decouvrir sur un routeur en production.
#
# On attend 404 : le jeton est invente, donc inconnu. C'est la preuve que la
# requete a bien atteint le serveur.
echo
# Les pairs, appliques puis constates.
#
# Le serveur vient de les ecrire dans `pairs.conf` a son demarrage. On demande
# leur application, puis **on regarde l'interface** -- ecrire un fichier et
# charger un pair sont deux choses, et la console ne peut voir que la premiere.
echo
echo "── Pairs du tunnel"
systemctl start gemikrot-tunnel.service 2>/dev/null || true
sleep 2
PAIRS_FICHIER=$(grep -c '^\[Peer\]' /etc/wireguard/pairs.conf 2>/dev/null || echo 0)
PAIRS_CHARGES=$(wg show wg0 peers 2>/dev/null | grep -c . || echo 0)
if [ "$PAIRS_FICHIER" -eq 0 ]; then
  echo "   Aucun routeur raccordé pour l'instant."
elif [ "$PAIRS_CHARGES" -ge "$PAIRS_FICHIER" ]; then
  echo "   $PAIRS_CHARGES pair(s) chargé(s) dans le tunnel."
else
  echo "   ⚠ $PAIRS_FICHIER pair(s) dans le fichier, $PAIRS_CHARGES chargé(s)."
  echo "     Le tunnel ne les a pas pris. Voir : journalctl -u gemikrot-tunnel.service"
fi

echo "── Vérification du chemin de rappel"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  "https://$DOMAINE_PUBLIC/api/router-enrollments/callback/verification" \
  -H 'Content-Type: application/json' \
  -d '{"publicKey":"vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv="}' || echo 000)
case "$CODE" in
  404) echo "   Le rappel atteint le serveur." ;;
  405) echo "   ⚠ 405 : le relais /api ne mène pas au serveur. Le raccordement échouera." ;;
  000) echo "   ⚠ Aucune réponse. Le certificat n'est peut-être pas encore délivré ; réessayez dans une minute." ;;
  *)   echo "   ⚠ Réponse inattendue : $CODE" ;;
esac

echo
echo "════════════════════════════════════════════════════════"
echo " Installé."
echo
echo "   Console      https://$DOMAINE_PUBLIC"
echo "   Compte       $(grep '^SEED_ADMIN_EMAIL=' "$REGLAGES" | cut -d= -f2)"
echo "   Mot de passe $(grep '^SEED_ADMIN_PASSWORD=' "$REGLAGES" | cut -d= -f2)"
echo
echo "   Clé publique du tunnel : $CLE_PUBLIQUE"
echo
echo " ⚠  Notez ce mot de passe et changez-le à la première connexion."
echo
echo " ⚠  Sauvegardez ces deux valeurs HORS de ce serveur :"
echo "      ROUTER_CREDENTIALS_KEY  — les perdre rend illisibles les"
echo "                                identifiants de tous vos routeurs"
echo "      /etc/wireguard/serveur.cle"
echo "════════════════════════════════════════════════════════"
