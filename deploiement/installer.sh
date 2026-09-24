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
WIREGUARD_CONFIG_PATH=/etc/wireguard/wg0.conf
PUBLIC_BASE_URL=https://$DOMAINE_PUBLIC/api
MIKROTIK_TLS_REJECT_UNAUTHORIZED=true
SCHEDULER_ENABLED=true
SEED_ADMIN_EMAIL=gemikrot@gmail.com
SEED_ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-12)
FIN
  chmod 600 "$REGLAGES"
  echo "   Tirés et enregistrés dans $REGLAGES (lisible du seul root)."
fi

# ────────────────────────────────────────────────────────── 4. Le tunnel
#
# La clé privée du serveur est produite ici et n'en sort jamais. La perdre
# obligerait à raccorder de nouveau chaque routeur, sur place.
echo
echo "── 4/6 · Le tunnel"
if [ -f /etc/wireguard/wg0.conf ]; then
  echo "   Déjà monté, conservé."
else
  umask 077
  mkdir -p /etc/wireguard
  wg genkey > /etc/wireguard/serveur.cle
  wg pubkey < /etc/wireguard/serveur.cle > /etc/wireguard/serveur.pub
  cat > /etc/wireguard/wg0.conf <<FIN
# GeMikrot — bout serveur du tunnel.
#
# Les pairs s'ajoutent tout seuls : la console écrit ce fichier après chaque
# raccordement, et un observateur systemd applique la modification sans
# couper le tunnel. Aucun geste manuel.

[Interface]
PrivateKey = $(cat /etc/wireguard/serveur.cle)
# /16 et non /32 : c'est cette adresse qui crée la route vers tout le
# sous-réseau du tunnel. En /32, le serveur saurait recevoir les appels des
# routeurs mais pas leur répondre.
Address = 10.88.0.1/16
ListenPort = $PORT_TUNNEL
FIN
  echo "   Clé produite, interface décrite."
fi
CLE_PUBLIQUE=$(cat /etc/wireguard/serveur.pub)
grep -q '^WIREGUARD_SERVER_PUBLIC_KEY=' "$REGLAGES" \
  || echo "WIREGUARD_SERVER_PUBLIC_KEY=$CLE_PUBLIQUE" >> "$REGLAGES"

systemctl enable --now wg-quick@wg0 >/dev/null 2>&1 || systemctl restart wg-quick@wg0

# **L'observateur.** La console écrit le fichier ; sans cela il faudrait
# recharger le tunnel à la main après chaque raccordement — l'étape qui a
# échoué quatre fois de suite sur le poste de développement.
#
# `syncconf` et non `down/up` : il applique les pairs sans couper l'interface,
# donc sans faire tomber les routeurs déjà connectés.
cat > /etc/systemd/system/gemikrot-tunnel.path <<'FIN'
[Unit]
Description=Surveille wg0.conf et applique les pairs que la console y écrit

[Path]
PathChanged=/etc/wireguard/wg0.conf

[Install]
WantedBy=multi-user.target
FIN
cat > /etc/systemd/system/gemikrot-tunnel.service <<'FIN'
[Unit]
Description=Applique les pairs de wg0.conf sans couper le tunnel

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'wg syncconf wg0 <(wg-quick strip wg0)'
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
