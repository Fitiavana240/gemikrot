# Mettre GeMikrot en production

Quatre conteneurs sur un VPS : la base, les migrations, le serveur, Caddy.
Quatre gigaoctets de mémoire suffisent largement.

Tout ce qui suit a été construit et démarré pour de vrai avant d'être écrit
ici — les deux images, le point de santé, et le relais `/api` de Caddy vers le
serveur. Ce qui n'a **pas** été éprouvé est signalé comme tel.

---

## 1. Les fichiers

| Fichier | Ce qu'il fait |
|---|---|
| `Dockerfile.backend` | Le serveur. Sert aussi au conteneur de migration. |
| `Dockerfile.web` | La console construite, servie par Caddy. |
| `Caddyfile` | Un domaine, les fichiers statiques, et `/api` vers le serveur. |
| `docker-compose.prod.yml` | Les quatre conteneurs et leurs volumes. |
| `env.production.exemple` | À recopier en `.env.production`, à la racine. |
| `sauvegarde.sh` | Le dump nocturne, chiffré, déposé ailleurs. |
| `restauration-eprouvee.sh` | L'exercice mensuel. |

## 2. Le premier déploiement

```bash
cp deploiement/env.production.exemple .env.production
# remplir les valeurs, en particulier les deux clés de 32 octets
openssl rand -hex 32   # ROUTER_CREDENTIALS_KEY
openssl rand -hex 32   # JWT_SECRET

docker compose -f deploiement/docker-compose.prod.yml up -d --build
```

Le conteneur `migrate` applique les migrations et s'arrête ; le serveur
n'attend que son succès pour démarrer.

Vérifier :

```bash
curl -s https://VOTRE-DOMAINE/health
```

`{"statut":"ok", ...}` avec un code 200. Une base tombée rend **503** — c'est
le code que lit un moniteur, pas le corps de la réponse.

## 3. Ce qui se sauvegarde à part, et pourquoi

`ROUTER_CREDENTIALS_KEY` chiffre les identifiants de tous les routeurs
enregistrés. `JWT_SECRET` signe les sessions. Les ranger avec le dump
annulerait exactement le chiffrement qu'ils protègent : qui obtient le
fichier obtient les deux.

**Perdre `ROUTER_CREDENTIALS_KEY` rend illisibles les identifiants de tous les
routeurs.** Chacun devrait être raccordé de nouveau, sur place, un par un.

Il faut donc, une fois, hors du serveur — gestionnaire de mots de passe, ou
papier dans un coffre :

- `ROUTER_CREDENTIALS_KEY`
- `JWT_SECRET`
- la clé privée du tunnel (`/etc/wireguard/wg0.conf`)

## 4. Les sauvegardes

```bash
export GEMIKROT_AGE_RECIPIENT="age1..."          # la clé publique
export GEMIKROT_DEPOT_DISTANT="distant:gemikrot" # une cible rclone
./deploiement/sauvegarde.sh
```

Dans cron, à deux heures du matin :

```
0 2 * * * /opt/gemikrot/deploiement/sauvegarde.sh >> /var/log/gemikrot-sauvegarde.log 2>&1
```

Et une fois par mois, l'exercice — **en lisant sa sortie** :

```bash
GEMIKROT_AGE_IDENTITY=~/cle-age.txt \
  ./deploiement/restauration-eprouvee.sh /var/backups/gemikrot/la-plus-recente.dump.age
```

Il restaure dans une base jetable, compte ce qu'il y trouve, et la supprime.
Une sauvegarde jamais restaurée n'est qu'un fichier dont on suppose le
contenu.

## 5. Deux pièges rencontrés en construisant ces images

Notés parce qu'ils ne se voient qu'à l'exécution, et qu'ils se reproduiront à
la prochaine mise à jour de base.

**Prisma choisit son moteur d'après la version d'OpenSSL qu'il trouve.**
L'étape de construction ne portait pas le paquet : il devinait
`debian-openssl-1.1.x` alors que l'image d'exécution porte du 3.0. L'image se
construisait sans une plainte, et le serveur s'arrêtait au démarrage sur
« could not locate the Query Engine ». OpenSSL est donc installé **dans les
deux étapes**.

**npm ne remonte pas tout à la racine.** Un conflit de versions laisse des
paquets dans le `node_modules` de l'espace concerné — ici 221, dont
`@nestjs/core`. Copier la seule racine donnait une image qui se construit et
un serveur qui meurt sur « Cannot find package ».

## 6. Ce qui reste à faire

- **Intégration continue.** Rien n'est écrit : ce dépôt n'a pas encore de
  dépôt distant. Le jour où il en aura un, un seul workflow suffit —
  construction, épreuves avec un service `postgres:16`, vérification de types
  du frontend, puis images et déploiement sur la branche principale.
- **Surveillance.** Uptime Kuma dans un conteneur, pointé sur `/health`. Pas
  de Prometheus ni Grafana à ce stade : plus de surface qu'une personne seule
  n'en entretient.
- **Le jeton hors du stockage local**, au profit d'un cookie `HttpOnly`. Tant
  que ce n'est pas fait, une injection de script vaut un vol de session.
- **Le découpage du paquet frontend** : 780 ko pour l'ensemble, alors que le
  client d'un portail captif n'a besoin que de la page de paiement.
