# GEMIKROT — Document de référence fonctionnel du SaaS
# Gestion de réseaux Wi-Fi MikroTik · Tickets, abonnements et paiement mobile — Madagascar

**Date de rédaction :** 2026-09-19 · **Statut :** v0.2 — socle multi-exploitants livré, tickets sur User Manager livrés, page de paiement publique livrée en validation manuelle, console multi-routeurs et tolérance aux pannes livrées (lot du 2026-09-19 ci-dessous). Reconnaissance automatique des SMS non commencée, PPPoE non couvert. Voir §16 Journal.
**Objet :** remplacer Winbox et le carnet de tickets par une console web multi-exploitants qui pilote **plusieurs routeurs MikroTik à distance**, vend des accès Wi-Fi (tickets et abonnements), encaisse par Mobile Money et coupe réellement les accès expirés.

> **Impact :** ⭐ Utile · ⭐⭐ Important · ⭐⭐⭐ Critique
> **Complexité :** 🟢 Faible · 🟡 Moyenne · 🔴 Élevée
> **Implémenté :** ✅ livré · 🟡 partiel · ⬜ à faire
>
> ⚠️ Ce document est le **seul suivi** du projet. La colonne « Implémenté » ne se coche
> qu'après vérification dans le code (compile + tests + essai sur le routeur réel), jamais sur intention.
> Avant de démarrer un item : **vérifier le code, pas la colonne.**

---

## 0. Analyse du besoin

### 0.1 Le terrain aujourd'hui

Un exploitant Wi-Fi de quartier possède un ou plusieurs MikroTik. Il administre tout par **Winbox**, en se connectant au routeur : il crée les comptes HotSpot un par un, imprime des tickets à la main ou les recopie, encaisse en espèces ou par Mobile Money, et tient ses comptes sur un cahier. Quand il s'absente, personne ne peut vendre.

Conséquences observées sur le parc réel (hAP ac², 646 comptes HotSpot, RouterOS 7.24.4) :

- **Aucun ticket n'expire jamais.** Les profils HotSpot ne portent qu'un `session-timeout` : il borne *une session* et repart à zéro à chaque reconnexion. Un ticket « 1 mois » vendu une fois sert indéfiniment. C'est la perte de revenu la plus directe du modèle actuel.
- **Un accès coupé continue de fonctionner.** Le profil serveur accepte le cookie (`login-by: mac,cookie,…`, durée de vie 3 jours) : un client déjà venu se reconnecte **sans repasser par RADIUS**, donc sans que sa validité soit vérifiée. Sur le parc, 4 des sessions actives sont entrées ainsi, et 46 cookies vivent en permanence.
- **Pas de vente sans l'exploitant.** Le client doit le trouver physiquement pour obtenir un code, même s'il a déjà payé par Mobile Money.
- **Aucun suivi commercial.** Qui a acheté quoi, quand, combien a-t-il consommé, quelle offre rapporte : rien n'est tenu ailleurs que dans la mémoire de l'exploitant.
- **Winbox n'est pas multi-sites.** Chaque routeur se pilote séparément, en étant sur son réseau ou via un VPN à monter soi-même.

### 0.2 Deux produits en un

1. **Console d'exploitation** (SaaS multi-exploitants) : routeurs, offres, tickets, abonnements, clients, paiements, statistiques — à distance, depuis un navigateur.
2. **Page client publique** : « je veux du Wi-Fi » → offres et prix → paiement Mobile Money → code d'accès, sans compte et sans intervention humaine.

> **Le cercle vertueux — et la difficulté n°1** : la page client n'a de valeur que si l'accès s'ouvre tout seul après paiement. Cela suppose de lire les SMS de confirmation de l'opérateur (COM-1). Sans cette brique, l'exploitant valide à la main et le produit n'est qu'un carnet électronique. D'où l'ordre de bataille (§14) : d'abord rendre l'expiration vraie, ensuite automatiser l'encaissement.

### 0.3 Personas

| Persona | Ce qu'il fait dans le produit |
|---|---|
| Client final | Choisit une offre, paie par Mobile Money, reçoit un code — **sans compte** |
| Vendeur / OPERATOR | Génère et imprime des lots de tickets, encaisse, valide un paiement, suspend un abusif |
| Exploitant / ADMIN | Offres et tarifs, routeurs, marque, puces Mobile Money, devise, comptes de son équipe |
| VIEWER | Consulte sans rien modifier (comptable, associé) |
| Super-admin (l'éditeur) | Active les exploitants, supervise la plateforme, facture l'abonnement |

### 0.4 Parcours clés (à ne jamais dégrader)

1. **Achat autonome** : portail captif → offres → numéro Mobile Money affiché → paiement → saisie numéro + référence → code d'accès à l'écran, sans intervention.
2. **Vente au comptoir** : lot de tickets généré et imprimé → le client paie en espèces → il saisit le code. Le ticket imprimé doit fonctionner **sans que personne ne l'active**.
3. **Expiration réelle** : la validité court à la première connexion, le routeur l'applique seul, et l'accès est coupé pour de bon — compte désactivé, cookies effacés, session fermée.
4. **Renouvellement d'abonnement** : avertissement, tolérance, suspension au non-paiement, rétablissement au paiement.
5. **Journée d'exploitation** : combien vendu, quelles offres, qui est connecté, combien consommé.

### 0.5 Contraintes structurantes (Madagascar / Toliara)

- **L'exploitant n'est pas informaticien.** Toute notion RouterOS exposée telle quelle est un échec d'interface : `session-timeout`, `starts-when`, `rate-limit-rx` doivent devenir « validité », « démarre à la 1re connexion », « débit descendant ».
- **Le routeur fait foi pour le réseau, la base pour le commerce.** L'expiration doit tenir même application arrêtée — sinon une coupure de courant chez l'exploitant rend le parc gratuit.
- **Mobile money dominant** (MVola, Orange Money, Airtel Money), espèces encore majoritaires au comptoir. Les deux, jamais l'un sans l'autre.
- **Le SMS est le canal** qui touche tout le monde — et c'est aussi la seule source de confirmation de paiement accessible sans contrat marchand.
- **Langues** : la console reste en français (elle s'adresse à l'exploitant) ; **la page client est en français et en malgache**.
- **Connectivité** : le routeur est en local, la console distante. Le lien peut tomber : l'application ne doit jamais devenir le point de défaillance de l'accès Internet des clients.
- **Matériel** : hAP ac² et équivalents, RouterOS 7.x, mémoire limitée — ne jamais supposer une API rapide ni une liste courte.

### 0.6 Modèle économique (à trancher)

- **Abonnement par exploitant**, paliers selon le **nombre de routeurs** — c'est le modèle du concurrent local observé (10 000 Ar / 30 jours, « N routeurs maximum »).
- Option : quota de SMS au-delà d'un seuil, mise en avant, assistance.
- ⚠️ **Ne pas prélever un pourcentage sur chaque ticket vendu** : perçu comme une taxe sur la recette, cela tuerait l'adoption chez des exploitants qui vendent à 500 Ar.

### 0.7 Ce que le produit n'est pas

- Pas un remplaçant de Winbox pour la configuration réseau (routage, pare-feu, VPN, sans-fil). Le produit couvre le **HotSpot et User Manager**, pas l'administration système du routeur.
- Pas un fournisseur d'accès : l'exploitant reste propriétaire de sa liaison et de son matériel.

---

## Table des matières

1. [Socle & multi-exploitants (SOC)](#1-socle--multi-exploitants-soc)
2. [Routeurs & intégration MikroTik (RTR)](#2-routeurs--intégration-mikrotik-rtr)
3. [Offres, profils & limitations (OFF)](#3-offres-profils--limitations-off)
4. [Tickets (TIC)](#4-tickets-tic)
5. [Abonnements (ABO)](#5-abonnements-abo)
6. [Clients & appareils (CLI)](#6-clients--appareils-cli)
7. [Paiements (PAY)](#7-paiements-pay)
8. [Portail client & page captive (PUB)](#8-portail-client--page-captive-pub)
9. [Communication (COM)](#9-communication-com)
10. [Statistiques & pilotage (STAT)](#10-statistiques--pilotage-stat)
11. [Super-admin SaaS (SAS)](#11-super-admin-saas-sas)
12. [Sécurité (SECU)](#12-sécurité-secu)
13. [Fiabilité, déploiement & performance (FIAB / DEPL / PERF)](#13-fiabilité-déploiement--performance-fiab--depl--perf)
14. [Ordre de bataille](#14-ordre-de-bataille)
15. [Risques & questions à trancher](#15-risques--questions-à-trancher)
16. [Journal de livraison](#16-journal-de-livraison)

### Lot du 2026-09-19 — routeurs distants et tolérance aux pannes

| Item | Intitulé | État |
|------|----------|------|
| SOC-9 | Multi-routeurs réel dans la console | ✅ livré |
| RTR-11 | Disjoncteur par routeur | ✅ livré, éprouvé sur le routeur réel |
| RTR-12 | File d'opérations différées | ✅ livré |
| RTR-13 | Enrôlement par tunnel WireGuard | ✅ éprouvé de bout en bout : script, rappel réseau, tunnel monté, application passant dedans |
| RTR-14 | PPPoE | 🟡 comptes, profils, serveurs et bassins livrés et éprouvés ; sessions actives non relevables |

**Vérifié** : 66 tests dans le paquet MikroTik, 91 dans le backend, `tsc` propre sur les trois espaces, migrations appliquées, application démarrée sans erreur d'injection.

**Vérifié contre le routeur réel (2026-09-20)** : appel de bout en bout en 599 ms par la fabrique de clients et le disjoncteur, identité `hAP`, état `JOIGNABLE` avant et après, épinglage TLS effectif. 646 comptes HotSpot, 48 cookies, 6 sessions — l'invariant des 646 comptes tient. RTR-11 n'est donc plus éprouvé seulement contre des simulacres.

**RTR-14, où il en est** (2026-09-20) : l'accès au routeur a été rétabli — le service `reverse-proxy` occupait le port 443 aux dépens de `www-ssl`. Le parc n'ayant aucun PPPoE, `scripts/probe-ppp-sonde.ts` a créé le minimum sur `ether4` (rien de branché, serveur posé désactivé), relevé les charges réelles, puis tout supprimé. Les correspondances sont écrites contre ce relevé, figé dans `tests/mappers/ppp.spec.ts`.

Trois pièges que le relevé a révélés, et qu'une lecture de la documentation aurait manqués : le profil PPP porte le débit en **un seul jeton** `"2M/2M"` là où la limitation User Manager utilise deux champs séparés ; `remote-address` contient un **nom de bassin**, pas une adresse ; et `last-logged-out` vaut `1970-01-01 00:00:00` pour un compte jamais connecté, ce qui l'aurait fait passer pour un abonné parti depuis cinquante ans. S'y ajoute que RouterOS mélange deux conventions booléennes dans le même objet — `default: "false"` à côté de `only-one: "yes"` — et que `max-sessions: "unlimited"` donne `NaN` si on le passe à `Number`.

**RTR-13, côté serveur, éprouvé le 2026-09-20** : rappel simulé exactement comme le routeur l'enverrait, en HTTP sur l'adresse du réseau. Réponse `201`, routeur créé sur l'adresse de tunnel attribuée, hôte égal à cette adresse, identifiants chiffrés en base, bon exploitant. Le rejeu du même jeton répond `404` — usage unique confirmé. Le pair WireGuard n'étant pas piloté sur ce poste, le journal rend la commande `wg set` exacte au lieu de faire croire le tunnel monté. Les objets de simulation ont été supprimés.

Restait alors l'exécution du script dans le terminal Winbox. Elle a suivi, et ce qui suit en rend compte.

**Répétition WireGuard sur le hAP réel (2026-09-20)** : chaque commande du script passe. Interface `gemikrot` créée avec sa clé privée qui ne quitte pas le routeur, route `10.88.0.0/16` active, groupe et compte applicatif limités créés, `persistent-keepalive=25` accepté. L'enrôlement a été mené à son terme avec la **vraie** clé publique relevée sur le routeur : réponse `201`, invitation consommée et liée, identifiants chiffrés.

Deux défauts que seule cette répétition pouvait révéler, tous deux corrigés :

1. **La ligne censée ajouter l'adresse du tunnel aux adresses autorisées a effacé la liste.** Le routeur n'était plus joignable que par Winbox. Cette ligne avait été ajoutée la veille précisément pour éviter ce scénario. Le script ne restreint donc plus rien : resserrer l'accès devient une étape séparée, après constat du tunnel — et qui peut alors passer par le tunnel.
2. **Les variables `:local` ne traversent pas deux lignes** collées l'une après l'autre dans le terminal. La clé publique serait partie vide sans que rien ne le signale. Le rappel calcule tout dans la commande elle-même.

Relevé au passage : le champ de `/ip/service` s'appelle `available-from`, `address=` n'en étant qu'un alias déprécié.

**Tunnel monté et éprouvé (2026-09-20)** : poignée de main établie, puis l'application a joint le routeur **par le tunnel**, sur son adresse `10.88.0.2`, avec le compte `gemikrot-api` créé par le script. Identité en 496 ms, disjoncteur `JOIGNABLE`, et lecture complète : 646 comptes HotSpot — l'invariant tient —, 50 cookies, 7 sessions, 10 profils, 3 comptes User Manager, 2 profils PPP.

Cela tranche la dernière question que la documentation ne tranchait pas : **les droits `read,write,api,rest-api,test` suffisent à l'API REST**. Le compte applicatif n'a pas besoin de `sensitive`, ni de `web`, ni de `policy`.

**Dernier maillon franchi** : le routeur a appelé l'application lui-même, par le réseau, avec la ligne exacte du script — `status: finished`, `code: 201`. Enrôlement créé côté serveur. Plus aucune étape de RTR-13 n'a été simulée ou contournée. Les enregistrements de répétition ont ensuite été supprimés, rien n'y étant rattaché.

**Le symptôme à savoir lire** : côté routeur, `tx` qui grimpe, `rx` à zéro et aucune poignée de main signifient que le routeur appelle une adresse où personne ne répond — mauvais point de terminaison, port fermé, ou serveur déplacé. Ce n'est ni une affaire de clés ni de pare-feu du routeur. Éprouvé à la dure pendant la répétition : le bail DHCP du poste avait tourné entre la génération du script et son exécution, et le pair pointait sur une adresse que la machine ne portait plus. La console devra distinguer ce cas de « tunnel monté mais API muette », dont le remède n'a rien à voir.

**Ce qui reste sur RTR-13** : le tunnel n'a jamais été monté — aucun WireGuard n'écoutait côté serveur, c'était assumé. Et le `/tool/fetch` n'a pas atteint l'application, le pare-feu Windows bloquant l'entrant ; RouterOS avait bien accepté la commande et tenté la connexion, l'échec est réseau et non syntaxique. En production le pare-feu concerné est celui du VPS.

**Ce qui reste** : les sessions actives (`/ppp/active`) ne se relèvent qu'avec un abonné PPPoE réellement connecté. La logique de leur correspondance est testée, leurs **noms de champs** ne le sont pas, et c'est écrit dans le test. À confirmer au premier abonné.

**Éprouvé sur le hAP réel le 2026-09-20** : disjoncteur (RTR-11), correspondances PPPoE (RTR-14), et la chaîne complète de l'enrôlement WireGuard (RTR-13) — script collé dans Winbox, rappel du routeur vers le serveur, tunnel monté, application joignant le routeur par le tunnel avec le compte limité créé par le script. L'invariant du parc, 646 comptes HotSpot, tient à chaque mesure.

Trois défauts n'ont pu être trouvés que là : une ligne du script qui **coupait l'accès au routeur** — ajoutée la veille pour empêcher exactement cela —, des variables `:local` qui **ne traversent pas deux lignes** et auraient envoyé une clé vide en silence, et le débit PPP lu en un seul jeton là où User Manager en utilise deux.

*Livré par Claude Opus 5, les 19 et 20 septembre 2026. La colonne « Implémenté » n'est cochée que pour ce qui compile, passe les tests, démarre et — sauf mention contraire — a été constaté sur le routeur réel. Ce qui ne l'a pas été est nommé ligne par ligne, jamais arrondi.*

---

## 1. Socle & multi-exploitants (SOC)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| SOC-1 | **Multi-exploitants** : tenant = exploitant Wi-Fi. Isolation appliquée au niveau de l'accès aux données par extension Prisma, pas laissée à la discipline de chaque requête. `scopedStrict` refuse de travailler hors exploitant au lieu de dégrader en client non cloisonné | ⭐⭐⭐ | 🔴 | ✅ |
| SOC-2 | **Rôles RBAC** : SUPER_ADMIN (plateforme), ADMIN (exploitant), OPERATOR (vend), VIEWER (consulte). Garde globale + `@Roles()` par route ; un ADMIN crée ses OPERATOR/VIEWER | ⭐⭐⭐ | 🟢 | ✅ |
| SOC-3 | **Inscription libre puis activation** par le super-admin. Connexion refusée avec un message distinct selon que le compte est en attente ou suspendu | ⭐⭐ | 🟢 | ✅ |
| SOC-4 | **Marque de l'exploitant** : nom du Wi-Fi, logo, domaines, devise (ISO 4217), identifiant public (slug) pour l'adresse de la page client | ⭐⭐ | 🟢 | ✅ |
| SOC-5 | **Puces Mobile Money** : numéro + nom du titulaire par opérateur, affichés au client. Bascule actif/inactif depuis la console — désactiver plutôt que supprimer, une puce retirée du commerce gardant ses paiements passés | ⭐⭐⭐ | 🟢 | ✅ |
| SOC-6 | **Audit de toutes les opérations** (qui, quand, quoi, depuis quelle IP) : connexions, paiements, tickets, écritures routeur. Consultable depuis la console, filtrable, réservé aux rôles d'administration | ⭐⭐⭐ | 🟢 | ✅ |
| SOC-7 | **Devise par exploitant**, formatage `Intl.NumberFormat`, devise figée sur chaque paiement pour que l'historique reste lisible après changement | ⭐⭐ | 🟢 | ✅ |
| SOC-8 | **i18n de la console** FR (+ MG/EN). La console est en français en dur ; seule la page client est bilingue | ⭐ | 🟡 | ⬜ |
| SOC-9 | **Multi-routeurs réel** : sélecteur de routeur dans la console et propagation partout, via un contexte React et un choix mémorisé. Le repli sur « le plus ancien routeur enregistré » a disparu de l'interface | ⭐⭐⭐ | 🟡 | ✅ |

---

## 2. Routeurs & intégration MikroTik (RTR)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| RTR-1 | **Client REST RouterOS** isolé dans un paquet dédié : aucune couche métier ne connaît les chemins `/rest/…` ni le vocabulaire kebab-case. PUT crée, PATCH modifie, POST exécute une commande | ⭐⭐⭐ | 🔴 | ✅ |
| RTR-2 | **Identifiants chiffrés** AES-256-GCM en base, déchiffrés à la volée, jamais exposés au navigateur ni journalisés | ⭐⭐⭐ | 🟡 | ✅ |
| RTR-3 | **Épinglage TLS** par empreinte de certificat, vérifié par un connecteur dédié (Node ne valide pas l'identité quand `rejectUnauthorized` est désactivé) | ⭐⭐⭐ | 🔴 | ✅ |
| RTR-4 | **Import de l'existant** : profils et comptes déjà sur le routeur repris en offres et clients, en mode simulation d'abord, sans écraser ce qu'un admin a réglé | ⭐⭐ | 🟡 | ✅ |
| RTR-5 | **Supervision** : identité, ressources, horloge, NTP, état RADIUS, interfaces | ⭐⭐ | 🟢 | ✅ |
| RTR-6 | **Sessions actives & hôtes** : qui est connecté, depuis quand, combien consommé, déconnexion | ⭐⭐⭐ | 🟢 | ✅ |
| RTR-7 | **Contournement du portail** (ip-binding) pour les appareils incapables d'afficher une page captive : TV, caméra, imprimante. `bypassed` ↔ `blocked` piloté depuis la console | ⭐⭐⭐ | 🟡 | ✅ |
| RTR-8 | **Walled Garden** : ce qu'un client joint avant authentification, par domaine et par adresse. Indispensable pour que la page de paiement soit atteignable | ⭐⭐⭐ | 🟢 | ✅ |
| RTR-9 | **Cookies HotSpot** : liste, durée restante, purge par compte. C'est la faille d'expiration du parc — un cookie vivant rouvre une session sans consulter la validité | ⭐⭐⭐ | 🟡 | ✅ |
| RTR-10 | **Serveurs et profils de serveur** en lecture, avec mise en évidence de `login-by` et de la durée de vie des cookies | ⭐⭐ | 🟢 | ✅ |
| RTR-11 | **Reconnexion et tolérance aux pannes** : disjoncteur par routeur. Trois échecs réseau d'affilée suspendent les appels trente secondes, puis un appel sonde le retour. Mesuré : 16 153 ms → 2 ms pour un routeur mort. Seules les erreurs de réseau l'ouvrent — un mot de passe refusé n'a rien à voir avec la joignabilité | ⭐⭐⭐ | 🟡 | ✅ |
| RTR-12 | **File d'opérations différées** : ce qui n'a pas pu partir est mis en file et rejoué dès que le disjoncteur constate le retour du routeur. N'accepte que des opérations rejouables sans dommage ; abandonne au bout de dix tentatives, mais en le disant. La console affiche ce qui attend | ⭐⭐⭐ | 🔴 | ✅ |
| RTR-13 | **Accès distant** : le routeur ouvre un tunnel WireGuard vers le serveur. Jeton d'enrôlement à usage unique, script à coller dans Winbox, clé privée jamais transmise, compte d'API dédié, `www-ssl` restreint au tunnel. Éprouvé de bout en bout sur le hAP : script collé dans Winbox, rappel du routeur, tunnel monté, application passant dedans | ⭐⭐⭐ | 🔴 | ✅ |
| RTR-14 | **PPPoE** en plus du HotSpot : comptes, profils, serveurs et bassins livrés, correspondances écrites contre un relevé réel (`scripts/probe-ppp-sonde.ts`). **Les sessions actives restent non vérifiées** : le parc n'a aucun PPPoE en service, les noms de champs de `/ppp/active` sont donc pris de la documentation seule — et le test le dit | ⭐⭐ | 🔴 | 🟡 |
| RTR-15 | **Menus IP en lecture** : files simples (le débit réellement alloué, client par client), journal du routeur, interfaces avec leurs coupures de lien, services d'administration, DDNS, ARP, serveurs DHCP, **pare-feu filtrage et NAT dans leur ordre d'évaluation**, DNS et entrées statiques, table de routage. **Lecture seule, par décision** : la console montre, WinBox modifie | ⭐⭐ | 🟡 | ✅ |
| RTR-16 | **Stockage et préparation de User Manager** : mémoire interne, clés USB et leur état de montage, paquets installés, occupation par support, et où vit la base User Manager. Rend un diagnostic ordonné par gravité, avec la commande exacte quand il en existe une — dont la réponse à « pourquoi l'onglet User Manager n'apparaît-il pas dans WinBox » | ⭐⭐⭐ | 🟡 | ✅ |

---

## 3. Offres, profils & limitations (OFF)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| OFF-1 | **Une offre = un profil User Manager** portant une **validité calendaire**, réconcilié de façon idempotente. Rejouée sans changement, la réconciliation n'écrit rien | ⭐⭐⭐ | 🔴 | ✅ |
| OFF-2 | **Limitations de débit et de volume** rattachées au profil par jonction ; retirées quand l'offre cesse d'imposer un plafond, sinon l'ancien continuerait de s'appliquer en silence | ⭐⭐⭐ | 🟡 | ✅ |
| OFF-3 | **Un seul endroit calcule la validité d'un profil.** Les abonnements avaient leur propre routine : deux chemins écrivaient le même objet avec des valeurs différentes | ⭐⭐⭐ | 🟡 | ✅ |
| OFF-4 | **Console User Manager** : profils, limitations, comptes, attributions — créés et supprimés depuis l'interface, avec refus explicite quand le routeur s'y oppose | ⭐⭐ | 🟡 | ✅ |
| OFF-5 | **Tous les comptes du routeur visibles**, y compris ceux créés hors application, étiquetés comme tels et jamais rattachés d'office à un client | ⭐⭐ | 🟢 | ✅ |
| OFF-6 | **Nombre d'appareils simultanés** par offre (`shared-users`) | ⭐⭐ | 🟢 | ✅ |
| OFF-7 | **Grilles tarifaires datées** : une hausse ne doit pas réécrire le prix des tickets déjà vendus. Le prix est figé sur le ticket, mais l'historique des grilles n'existe pas | ⭐ | 🟡 | 🟡 |
| OFF-8 | **Offres par routeur ou par site** : aujourd'hui une offre est réconciliée sur le routeur par défaut uniquement | ⭐⭐ | 🟡 | ⬜ |

---

## 4. Tickets (TIC)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| TIC-1 | **Génération par lot**, code unique, provisionné sur le routeur **dès la génération** : un ticket imprimé fonctionne sans qu'un vendeur l'active | ⭐⭐⭐ | 🟡 | ✅ |
| TIC-2 | **Validité qui démarre à la première connexion** : un ticket invendu ne s'use pas | ⭐⭐⭐ | 🟡 | ✅ |
| TIC-3 | **Expiration réelle, tenue par le routeur**, réconciliée en base pour l'affichage. La liste des expirés inclut ceux dont l'échéance est passée mais pas encore relue | ⭐⭐⭐ | 🔴 | ✅ |
| TIC-4 | **Coupure effective d'un accès** : compte désactivé **et** cookies effacés **et** session fermée. Sans les deux derniers, un ticket expiré sert encore jusqu'à trois jours | ⭐⭐⭐ | 🟡 | ✅ |
| TIC-5 | **Répartition par offre** : combien à vendre, vendus, en cours, expirés | ⭐⭐ | 🟢 | ✅ |
| TIC-6 | **Tickets historiques** d'avant la bascule, servis par le HotSpot local, dans un onglet à part et jamais modifiés | ⭐⭐ | 🟢 | ✅ |
| TIC-7 | **Modèle de ticket imprimable** en HTML, avec logo, 30 par A4 et grand format. Refusé — pas nettoyé en silence — s'il contient autre chose que de la mise en forme | ⭐⭐ | 🟡 | ✅ |
| TIC-8 | **Réconciliation périodique automatique** : travail d'expiration toutes les minutes, réconciliation par routeur toutes les 15 minutes, chacun sous verrou. Un ticket expiré la nuit voit ses cookies purgés sans intervention | ⭐⭐⭐ | 🟡 | ✅ |
| TIC-9 | **QR code sur le ticket** : le client scanne au lieu de recopier dix caractères | ⭐⭐ | 🟢 | ⬜ |
| TIC-10 | **Impression thermique** (ESC/POS, 58/80 mm) en plus de l'A4 | ⭐ | 🟡 | ⬜ |
| TIC-11 | **Suivi de lot** : quel lot, généré quand, par qui, combien vendus et combien restants. Décompte rapporté au nombre réellement créé, une génération interrompue en ayant produit moins | ⭐⭐ | 🟢 | ✅ |

---

## 5. Abonnements (ABO)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| ABO-1 | **Abonnement porté par User Manager**, échéance calendaire relue depuis le routeur qui fait autorité | ⭐⭐⭐ | 🟡 | ✅ |
| ABO-2 | **Suspension et réactivation** sans perdre le compte ni son historique | ⭐⭐⭐ | 🟢 | ✅ |
| ABO-3 | **Tolérance de 7 jours** après échéance avant suspension, comme demandé. Le statut se dérive correctement des trois états ; la reprise refuse au-delà de la tolérance plutôt que de rouvrir un accès que la base dirait suspendu | ⭐⭐⭐ | 🟢 | ✅ |
| ABO-4 | **Avertissement avant échéance** au client (SMS). Dépend de COM-1 | ⭐⭐⭐ | 🟡 | ⬜ |
| ABO-5 | **Suspension automatique** au dépassement de la tolérance, par le travail d'expiration. Le compte n'est marqué suspendu que si le routeur l'a réellement coupé | ⭐⭐⭐ | 🟡 | ✅ |
| ABO-6 | **Renouvellement par paiement**, avec rétablissement immédiat et échéance repoussée | ⭐⭐⭐ | 🟡 | 🟡 |
| ABO-7 | **Coupure effective** identique à TIC-4 (cookies + session), branchée sur le chemin abonnement par le travail d'expiration | ⭐⭐⭐ | 🟢 | ✅ |

---

## 6. Clients & appareils (CLI)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| CLI-1 | **Fiche client** : nom, téléphone (unique par exploitant), historique d'achats | ⭐⭐ | 🟢 | ✅ |
| CLI-2 | **Appareils** rattachés à un client, avec MAC, adresse et type | ⭐⭐ | 🟢 | ✅ |
| CLI-3 | **Détection du type d'appareil** (nom DHCP, fabricant MAC) pour repérer ceux qui ne peuvent pas afficher un portail captif ; proposition confirmée par un admin, jamais imposée | ⭐⭐ | 🟡 | ✅ |
| CLI-4 | **Consommation par client** : durée et volume, depuis la comptabilité RADIUS | ⭐⭐ | 🟢 | 🟡 |
| CLI-5 | **Fiche client unifiée** : tickets, abonnement, appareils et paiements sur un écran, avec l'accès en cours mis en avant — c'est la question posée au comptoir | ⭐⭐ | 🟡 | ✅ |

---

## 7. Paiements (PAY)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| PAY-1 | **Encaissement manuel** (espèces, Mobile Money constaté) avec référence, et **idempotence** garantie par contrainte unique (exploitant, méthode, référence) | ⭐⭐⭐ | 🟡 | ✅ |
| PAY-2 | **Validation en un clic** : le paiement vérifié délivre un ticket provisionné et son code | ⭐⭐⭐ | 🟡 | ✅ |
| PAY-3 | **Reconnaissance automatique des SMS Mobile Money** : point d'entrée signé, lecture du montant, de l'émetteur et de la référence, rapprochement du paiement en attente. **Cœur de la promesse produit, non commencé** | ⭐⭐⭐ | 🔴 | ⬜ |
| PAY-4 | **Motifs de lecture paramétrables par exploitant**, avec un champ pour coller un vrai SMS et vérifier ce qui en est extrait | ⭐⭐⭐ | 🟡 | ⬜ |
| PAY-5 | **Journal des SMS reçus** : rapprochés, non rapprochés avec le motif, rejoués. Sans lui, un paiement perdu est inexplicable | ⭐⭐⭐ | 🟡 | ⬜ |
| PAY-6 | **API marchand opérateur** (MVola, Orange Money) en remplacement du SMS quand l'exploitant a un contrat | ⭐ | 🔴 | ⬜ |
| PAY-7 | **Remboursement et annulation** tracés | ⭐ | 🟡 | 🟡 |
| PAY-8 | **Masquage de la référence** hors rôles qui valident : masquée côté serveur, quatre derniers caractères visibles pour rapprocher un bordereau sans pouvoir s'en servir | ⭐⭐ | 🟢 | ✅ |

---

## 8. Portail client & page captive (PUB)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| PUB-1 | **Page de paiement publique** par exploitant (`/p/{slug}`) : offres, prix, puce où payer avec le nom du titulaire | ⭐⭐⭐ | 🟡 | ✅ |
| PUB-2 | **Déclaration de paiement sans compte** : numéro + référence, jeton de suivi, rien d'ouvert avant vérification | ⭐⭐⭐ | 🟡 | ✅ |
| PUB-3 | **Retrouver son accès** en ressaisissant numéro et référence — une recherche, pas une authentification ; le code n'est rendu qu'une fois le paiement vérifié | ⭐⭐⭐ | 🟡 | ✅ |
| PUB-4 | **Normalisation partagée** du téléphone et de la référence entre le formulaire et le futur lecteur de SMS. Deux implémentations divergentes donneraient zéro rapprochement, sans erreur ni trace | ⭐⭐⭐ | 🟡 | ✅ |
| PUB-5 | **Bilingue français / malgache** sur la page client | ⭐⭐ | 🟢 | ✅ |
| PUB-6 | **Limitation de débit** par (exploitant, téléphone) et (exploitant, référence) en primaire, l'IP en filet — derrière le portail captif tous les clients partagent l'adresse du routeur | ⭐⭐⭐ | 🟡 | ✅ |
| PUB-7 | **Page captive branchée** sur la page de paiement : lien « j'ai payé par Mobile Money », marque de l'exploitant à la place du nom en dur, et récupération du code sans quitter le portail | ⭐⭐⭐ | 🟡 | ⬜ |
| PUB-8 | **Lien WhatsApp d'assistance** sur la page client — le canal naturel ici quand un paiement n'aboutit pas | ⭐⭐ | 🟢 | ⬜ |
| PUB-9 | **Vitrine de l'exploitant** (offres publiques, présentation) sur son domaine ou sous-domaine | ⭐ | 🟡 | ⬜ |

---

## 9. Communication (COM)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| COM-1 | **Réception des SMS** : passerelle Android qui renvoie chaque message reçu sur la puce vers l'application. Pré-requis de PAY-3 | ⭐⭐⭐ | 🟡 | ⬜ |
| COM-2 | **Envoi de SMS** : code d'accès, avertissement d'échéance, confirmation. File persistée avec reprise, jamais d'échec silencieux | ⭐⭐⭐ | 🟡 | ⬜ |
| COM-3 | **Modèles FR/MG** par type de message | ⭐⭐ | 🟢 | ⬜ |
| COM-4 | **Quota et coût** par exploitant, avec compteur visible | ⭐ | 🟢 | ⬜ |

---

## 10. Statistiques & pilotage (STAT)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| STAT-1 | **Tableau de bord** : recette, clients, tickets, sessions actives | ⭐⭐ | 🟢 | 🟡 |
| STAT-2 | **Recette par offre et par période**, pour savoir ce qui se vend | ⭐⭐ | 🟡 | 🟡 |
| STAT-3 | **Consommation par compte** depuis la comptabilité RADIUS : durée, volumes, cause de fin | ⭐⭐ | 🟢 | ✅ |
| STAT-4 | **Taux d'occupation et pointes** : à quelle heure le réseau sature | ⭐ | 🟡 | ⬜ |
| STAT-5 | **Export comptable** (CSV) des paiements sur une période | ⭐⭐ | 🟢 | ⬜ |

---

## 11. Super-admin SaaS (SAS)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| SAS-1 | **Liste des exploitants**, activation, suspension | ⭐⭐⭐ | 🟢 | ✅ |
| SAS-2 | **Abonnement plateforme** : offre, nombre de routeurs autorisé, échéance, blocage à l'expiration. Un exploitant est aujourd'hui actif ou suspendu, rien ne le fait payer | ⭐⭐⭐ | 🟡 | ⬜ |
| SAS-3 | **Accompagnement à la mise en route** : étapes visibles (routeur connecté, offres créées, puce enregistrée, première vente) | ⭐⭐ | 🟡 | ⬜ |
| SAS-4 | **Supervision de la plateforme** : exploitants actifs, routeurs joignables, volumétrie | ⭐⭐ | 🟡 | ⬜ |
| SAS-5 | **Prise en main d'un compte** (impersonation) pour l'assistance, tracée | ⭐ | 🟡 | ⬜ |

---

## 12. Sécurité (SECU)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| SECU-1 | **Isolation testée entre exploitants** : lecture, écriture, suppression, création automatique, et refus hors contexte. 8 tests contre la vraie base, plus 3 au niveau service sur l'import. **Clés étrangères composites `(tenant_id, id)` sur les 19 relations entre modèles cloisonnés** : la garantie ne dépend plus du code appelant | ⭐⭐⭐ | 🔴 | ✅ |
| SECU-2 | **Identifiants routeur chiffrés**, jamais renvoyés au navigateur ni journalisés (§RTR-2) | ⭐⭐⭐ | 🟡 | ✅ |
| SECU-3 | **En-têtes de sécurité HTTP**, `trust proxy` correct derrière le portail captif | ⭐⭐ | 🟢 | ✅ |
| SECU-4 | **Modèle de ticket confronté à une liste blanche** et refusé s'il contient autre chose que de la mise en forme ; rendu dans une iframe verrouillée où le navigateur interdit toute exécution | ⭐⭐⭐ | 🟡 | ✅ |
| SECU-5 | **Jeton court + rafraîchissement rotatif**. Aujourd'hui un JWT de **12 heures sans révocation possible** : un jeton volé reste valide une demi-journée, même après suppression du compte | ⭐⭐⭐ | 🟡 | ⬜ |
| SECU-6 | **Anti-force brute** sur la connexion : aucune limite aujourd'hui, le mot de passe d'un admin peut être essayé sans fin | ⭐⭐⭐ | 🟢 | ⬜ |
| SECU-7 | **Réinitialisation de mot de passe** : un exploitant qui oublie le sien est bloqué, seul le super-admin peut le débloquer en base | ⭐⭐⭐ | 🟡 | ⬜ |
| SECU-8 | **2FA (TOTP)** pour ADMIN et SUPER_ADMIN | ⭐⭐ | 🟡 | ⬜ |
| SECU-9 | **Politique de mot de passe** : 6 caractères minimum aujourd'hui, sans contrôle de robustesse | ⭐⭐ | 🟢 | 🟡 |
| SECU-10 | **Consultation du journal d'audit** depuis la console, filtrable par action, objet, issue et période. Pagination par curseur : le journal grossit pendant qu'on le feuillette | ⭐⭐ | 🟢 | ✅ |
| SECU-11 | **Signature du point d'entrée SMS** (HMAC sur le corps brut, horodatage, anti-rejeu). `rawBody` est déjà conservé pour ça | ⭐⭐⭐ | 🟡 | ⬜ |
| SECU-12 | **Validation de `logoUrl`** : simple chaîne aujourd'hui, une adresse `javascript:` y passe et ce logo entre dans le modèle de ticket | ⭐⭐ | 🟢 | ⬜ |
| SECU-13 | **Revue de sécurité externe** avant ouverture large de la page publique | ⭐⭐ | 🟡 | ⬜ |

---

## 13. Fiabilité, déploiement & performance (FIAB / DEPL / PERF)

| Ref | Description | Impact | Complexité | Implémenté |
|-----|-------------|--------|------------|------------|
| FIAB-1 | **Tests sur les invariants** contre PostgreSQL réel : isolation, provisionnement idempotent, normalisation partagée, refus de modèle dangereux. 65 tests backend + 49 paquet | ⭐⭐⭐ | 🔴 | 🟡 |
| FIAB-2 | **Couverture des services** : 8 services sur 26 ont un test. Les non couverts incluent `tenants`, `plans`, `routers`, `user-manager`, `hotspot`, `auth` | ⭐⭐⭐ | 🟡 | 🟡 |
| FIAB-3 | **Charges utiles réelles du routeur figées dans des tests.** Trois mappers avaient été écrits sur des suppositions et lisaient des champs inexistants — limitations, sessions, attributions. Chaque correction est verrouillée par un test portant la charge utile relevée | ⭐⭐⭐ | 🟡 | ✅ |
| FIAB-4 | **Tests de bout en bout** (navigateur) : aucun. Le squelette e2e existe mais ne teste que « Hello World » | ⭐⭐ | 🟡 | ⬜ |
| FIAB-5 | **Sauvegardes chiffrées quotidiennes + restauration testée.** Rien. Une perte de base efface tout l'historique commercial ; le routeur ne garde que l'état réseau | ⭐⭐⭐ | 🟡 | ⬜ |
| FIAB-6 | **Tâches de fond** : réconciliation des échéances, suspension à l'expiration, purge. `bullmq`, `ioredis` et `@nestjs/bullmq` sont **installés et jamais importés** ; Redis tourne pour rien | ⭐⭐⭐ | 🟡 | ⬜ |
| FIAB-7 | **Supervision** : point de santé, journalisation structurée, alerte quand un routeur devient injoignable. Aucun `/health`, aucune métrique | ⭐⭐⭐ | 🟡 | ⬜ |
| DEPL-1 | **Intégration continue** : aucun `.github`, aucun pipeline. Les tests ne tournent que sur la machine du développeur | ⭐⭐⭐ | 🟡 | ⬜ |
| DEPL-2 | **Conteneurisation de l'application** : `docker-compose` ne lance que Postgres et Redis ; aucun Dockerfile pour le backend ni le frontend | ⭐⭐⭐ | 🟡 | ⬜ |
| DEPL-3 | **Environnements séparés** test et production, avec bases distinctes | ⭐⭐⭐ | 🟡 | ⬜ |
| DEPL-4 | **TLS et nom de domaine** pour la console et les pages publiques | ⭐⭐⭐ | 🟡 | ⬜ |
| PERF-1 | **Appels routeur en O(1)** : la création en lot ne relit la liste des comptes qu'une fois. Les lectures restent des listes complètes sans pagination — 646 comptes aujourd'hui, à surveiller | ⭐⭐ | 🟡 | 🟡 |
| PERF-2 | **Cache des lectures routeur** : chaque écran interroge le routeur à chaque affichage. Les tables de cache existent en base et ne sont **jamais utilisées** | ⭐⭐ | 🟡 | ⬜ |
| PERF-3 | **Pagination** des listes (comptes, tickets, sessions) : tout est chargé d'un bloc | ⭐⭐ | 🟢 | ⬜ |

---

## 14. Ordre de bataille

### P0 — Rendre le produit exploitable sans surveillance *(en cours)*

> TIC-8 · ABO-5/7 · FIAB-6 · SECU-5/6/7 · SOC-5 · RTR-11 · DEPL-1/2/3/4 · FIAB-5

**Critère de sortie** : l'exploitant part trois jours, et à son retour **aucun accès expiré ne fonctionne encore**, aucun abonné impayé n'est connecté, et rien n'a été perdu. Tant que la réconciliation dépend d'un clic humain, le produit ne tient pas sa promesse principale.

### P1 — L'encaissement automatique

> COM-1 · PAY-3/4/5 · SECU-11 · PUB-7/8 · COM-2/3

Le client paie et se connecte seul, sans intervention. C'est le différenciateur ; c'est aussi ce qui rend la console vendable à un exploitant qui n'est pas toujours sur place.

### P2 — La plateforme comme produit

> SAS-2/3/4 · SOC-9 · RTR-13 · SECU-8/10/13 · STAT-1/2/5 · TIC-9/11

Facturer les exploitants, piloter plusieurs routeurs pour de bon, atteindre un routeur sans IP publique.

### P3 — La profondeur

> RTR-12/14 · OFF-7/8 · CLI-4/5 · TIC-10 · PUB-9 · SOC-8 · PERF-2/3 · FIAB-4 · PAY-6/7/8

---

## 15. Risques & questions à trancher

1. **Le cookie HotSpot rend l'expiration poreuse.** Traité pour la coupure explicite (TIC-4), **pas encore** pour l'expiration naturelle : tant que TIC-8 n'existe pas, un ticket expiré la nuit continue de servir. C'est le risque n°1 du modèle économique.
2. **Aucune tâche de fond n'existe.** Toute la logique d'expiration, de suspension et d'avertissement suppose un ordonnanceur. Redis tourne déjà, les paquets sont installés : c'est une décision à prendre, pas une dépendance à ajouter.
3. **Le SMS est le seul chemin vers l'encaissement automatique** sans contrat marchand. Il suppose un téléphone Android allumé, chargé et connecté. Prévoir dès la conception le repli manuel visible, et l'alerte quand la passerelle se tait.
4. **Sans accès distant (RTR-13), le produit n'est pas multi-sites.** La console doit aujourd'hui être sur le réseau du routeur. C'est la contradiction la plus directe avec l'objectif annoncé.
5. **Le jeton de 12 heures sans révocation** est la faiblesse la plus exploitable du socle actuel. Un poste partagé au comptoir suffit.
6. **La perte de la base est irréversible.** Le routeur garde les comptes, pas les clients, ni les paiements, ni l'historique. Aucune sauvegarde n'existe.
7. **Trois mappers écrits sur des suppositions se sont révélés faux** au contact du routeur. La règle est désormais : sonder le matériel avant d'écrire, figer la charge utile relevée dans un test. Les zones non encore sondées (PPPoE, files d'attente, sans-fil) sont à traiter pareil.
8. **Le modèle économique n'est pas tranché.** Sans SAS-2, la plateforme ne peut pas encaisser ses propres exploitants.
9. **Le concurrent local existe et couvre le PPPoE.** À arbitrer : est-ce un manque bloquant pour vendre, ou hors périmètre ?

---


### Ce que fait le concurrent local (relevé le 2026-09-20)

Relevé sur `mikromilalalala.com` et sur leur série de tutoriels. Utile parce
qu'il dit ce qu'un exploitant d'ici attend déjà, et ce qui se vend.

**Leur série de tutoriels est la carte de leurs fonctions** :

| | |
|---|---|
| VIDEO 2 | créer un abonnement, ajouter un routeur |
| VIDEO 3 | créer un profil, générer un ticket |
| VIDEO 4 | créer et régler le **paiement automatique** |
| VIDEO 5 | installer l'**APK Android** et le relier au paiement automatique |
| VIDEO 6 | créer un **compte PPPoE** |
| — | côté client : souscrire et renouveler un abonnement |

**Leur modèle économique**, lu sur leur page d'offres : abonnement mensuel de
l'exploitant à la plateforme, avec un **quota de routeurs par offre**,
payable en ariary **ou en USDT**. Les forfaits sont chargés depuis leur base,
donc modifiables sans redéploiement. Ils vendent par ailleurs un « template
pro » de page captive, séparément, 50 000 Ar.

**Rien de tout cela n'est absent de ce document** — SAS-2 pour l'abonnement
plateforme et son quota, COM-1 pour la passerelle SMS Android, PAY-3 pour le
rapprochement automatique, PUB-7 pour la page captive, PUB-9 pour la vitrine.
Le relevé ne change donc pas le périmètre : il confirme l'ordre de bataille et
désigne où ils gagnent aujourd'hui.

**Où ils nous devancent** : le paiement automatique de bout en bout, et la
facturation des exploitants — c'est-à-dire ce qui fait vivre le produit.

**Où nous les devançons**, d'après ce qui est visible : le cloisonnement
appliqué par la base, l'enrôlement par tunnel WireGuard, le disjoncteur et la
file d'opérations différées, le journal d'audit consultable. Ce sont des
qualités d'exploitation, invisibles à la démonstration — elles se remarquent
le jour où un routeur tombe, pas le jour de la vente.

---

## 16. Journal de livraison

### 2026-09-20 (suite) — L'application travaille sans qu'on la regarde

**Vérifié** : 111 tests backend (17 fichiers), 66 dans le paquet, `tsc` propre, migration appliquée, application démarrée.

**Éprouvé contre le hAP réel** : la réconciliation a lu les attributions du routeur, constaté le compte `test1h` expiré depuis le 17 septembre (état `used`), marqué le ticket et **supprimé un vrai cookie sur le routeur**. C'est là tout l'enjeu — User Manager fait respecter l'expiration seul, mais uniquement pour qui repasse par RADIUS ; un cookie vivant rouvre la session sans la consulter, trois jours durant.

Trois cadences, et non « tout, toutes les minutes ». L'**expiration** toutes les minutes ne lit que ce dont l'échéance vient de passer, d'après des dates déjà en base, et c'est le seul travail qui agit. La **réconciliation** relit la collection complète par routeur, toutes les 15 minutes. La **purge** passe la nuit.

Chaque travail prend un **verrou en base** : un routeur lent n'empile pas les exécutions, et deux instances ne balaient pas le même parc en double. Une table plutôt qu'un verrou consultatif, le travail durant des minutes et traversant plusieurs connexions du pool — avec l'avantage que l'état reste lisible. Le verrou expire de lui-même : un processus tué ne bloque pas le parc.

Deux règles que les tests figent. Un exploitant en échec ne prive pas les autres du passage. Et **un abonné n'est marqué suspendu que si le routeur l'a réellement coupé** : sinon la base dirait suspendu pendant que le client navigue, ce qui est pire que de ne rien faire puisque invisible. Quand le routeur est injoignable, l'opération part dans la file différée et le statut suit au passage suivant.

`@nestjs/schedule` a été essayé puis écarté : npm le remonte à la racine de l'espace de travail et entraîne `@nestjs/common` et `core` avec lui, laissant `platform-express` seul en dessous — l'application ne démarre plus. Trois intervalles fixes ne valaient pas ce risque.

### 2026-09-20 (suite) — Le cloisonnement descend dans la base

**Vérifié** : 101 tests backend (15 fichiers), 66 dans le paquet, `tsc` propre, application démarrée, migration appliquée.

L'extension Prisma ne protège que le code qui pense à passer par le client cloisonné — la fuite corrigée à l'import l'a montré. Les **19 relations entre modèles cloisonnés** portent désormais une clé étrangère composite `(tenant_id, id)` : une ligne ne peut plus référencer que des lignes du même exploitant, quel que soit le code appelant. Jusqu'ici la base acceptait volontiers un paiement de A rattaché à un client de B.

Les clés simples sont **remplacées**, pas doublées, et la sémantique `ON DELETE` est reprise à l'identique. Onze index uniques ajoutés, dont trois exigés par Prisma sur le côté définissant des relations un-à-un.

Contrôle avant migration : les 19 relations parcourues sur la base de développement, zéro ligne inter-exploitants. PostgreSQL refuserait de toute façon d'ajouter une contrainte que des lignes violent — un échec sur un autre environnement signale des données à réparer, pas une migration à forcer.

Les tests écrivent avec le client **non cloisonné**, délibérément : c'est la seule façon d'éprouver une contrainte de base, en contournant tout ce qui la précède. Vérifié aussi en SQL brut, hors de tout code applicatif : `insert or update on table "payments" violates foreign key constraint "payments_tenant_id_customer_id_fkey"`.

### 2026-09-20 (suite) — Les deux défauts trouvés à l'audit

**Vérifié** : 97 tests backend (14 fichiers), `tsc` propre, et les deux chemins de l'import éprouvés contre le hAP réel — l'exploitant propriétaire importe (7 offres, 14 abonnements, 4 appareils, 635 tickets ignorés), un autre exploitant visant le même routeur reçoit « introuvable ».

- **Fuite de cloisonnement à l'import (SECU-1)** — l'import est le seul point d'entrée qui change d'exploitant en cours de route : il se place sur celui du routeur importé, le SUPER_ADMIN qui le déclenche n'en ayant pas. Le routeur était résolu avec le client **brut**, si bien qu'un ADMIN connaissant l'identifiant d'un routeur d'un autre exploitant déclenchait un import dans les données de cet autre, et en recevait le détail. La résolution passe par le client cloisonné, qui traite les deux cas de lui-même. Un routeur d'un autre exploitant et un routeur inexistant rendent le même message.
- **`SUSPENDED` jamais dérivé (ABO-3)** — les deux dernières branches renvoyaient `GRACE` : au-delà de la tolérance, un abonné impayé restait « toléré ». Corriger la branche ne suffisait pas : `resume` rouvre l'accès sur le routeur **avant** d'écrire le statut, si bien que dériver `SUSPENDED` aurait produit une base qui dit suspendu pendant que le routeur laisse passer. La reprise refuse donc au-delà de la tolérance, avant tout appel au routeur, et renvoie vers le renouvellement.

Les deux tests de non-régression ont été **vérifiés rouges contre l'ancien code** avant d'être verts contre le nouveau. Les tests de cloisonnement existants ne pouvaient pas attraper le premier : ils éprouvent l'extension Prisma, pas les services qui choisissent de s'en passer.

### 2026-09-19 — Le routeur peut tomber, et être ailleurs

**Vérification** : 91 tests backend (13 fichiers), `tsc` propre sur les deux espaces, migrations appliquées. Le routeur du parc étant hors d'atteinte depuis ce poste, rien de ce lot n'a été éprouvé contre le matériel — c'est dit là où ça compte.

- **RTR-11 ✅** — disjoncteur par routeur. Un routeur mort coûtait le budget complet à chaque appel : 5 s de délai, trois tentatives, backoff, soit ~16 s. Un écran qui interroge trois fois en parallèle mettait près d'une minute à afficher une erreur, et l'exploitant en concluait que la console était cassée. Mesuré après : 2 ms. Seules les erreurs de réseau ouvrent le disjoncteur — confondre un mot de passe refusé avec une panne de lien couperait l'accès à un routeur parfaitement joignable, et masquerait la vraie cause.
- **SOC-9 ✅** — sélecteur de routeur porté par un contexte React, choix mémorisé, repli sur le premier routeur quand celui retenu disparaît. L'ancien `use-default-router` est supprimé : son propre commentaire annonçait son remplacement.
- **RTR-12 ✅** — file d'opérations différées. Le cas qui la justifie : un ticket expire pendant que le lien est coupé ; il était marqué expiré en base mais son accès restait ouvert, jusqu'à trois jours de cookie. La file garantit **au moins** une exécution, jamais exactement une : seules les opérations rejouables sans dommage y entrent. Elle s'arrête dès que le lien retombe plutôt que d'épuiser les tentatives de toute la file contre un routeur mort, et abandonne au bout de dix essais en conservant le motif. Déclenchée par le disjoncteur, sans tâche planifiée.
- **Coupure d'accès dédupliquée** — la coupure différée appelait une copie du code de coupure immédiate. Le trou des cookies ayant déjà été bouché une fois, une copie divergente l'aurait rouvert. Le service passe côté routeurs (`RouterAccessService`), où le HotSpot s'en servait déjà.
- **RTR-13 🟡** — enrôlement par tunnel WireGuard, côté application. Le routeur appelle le serveur : derrière la 4G ou un NAT d'opérateur, il n'a ni adresse fixe ni port ouvrable, et exiger l'inverse condamnerait la moitié du parc. La clé privée est créée par le routeur et ne le quitte jamais ; le jeton vaut mot de passe (256 bits, 30 min, usage unique, stocké haché) ; un jeton inconnu, expiré ou déjà servi donnent la même réponse. Là où le serveur ne porte pas l'interface, il rend la commande `wg` à passer au lieu de faire croire le tunnel monté. **Le script Winbox n'a pas encore tourné sur un routeur réel** : quatre correspondances de ce projet, écrites de bonne foi sur la documentation seule, se sont révélées fausses au contact du matériel.
- **RTR-14 ⬜** — non livré, et délibérément. La règle inscrite au §15.7 dit de sonder avant d'écrire et de figer la charge relevée dans un test ; PPPoE n'a jamais été sondé, et le routeur est injoignable depuis ce poste (réseau `hotspot-tati` quitté). Écrire les correspondances maintenant reviendrait à répéter exactement l'erreur qui a coûté quatre correctifs. Le relevé est préparé : `npm run probe:ppp <url> <compte> <motdepasse>` depuis le réseau du routeur écrit les charges utiles brutes de `/ppp/secret`, `/ppp/profile`, `/ppp/active` et des collections voisines, mots de passe caviardés, prêtes à servir de référence au test.

**Script d'enrôlement confronté à la documentation RouterOS v7** (même journée) : propriétés des pairs, `output=none` de `/tool/fetch`, forme de l'en-tête HTTP, `rest-api` comme politique de groupe, `public-key` en lecture seule. Deux corrections en sont sorties : `persistent-keepalive=25s` devient `25` — la propriété est documentée comme un entier, et `25` reste juste quelle que soit la lecture ; et une route explicite vers le réseau du tunnel est ajoutée, une adresse en /32 n'en créant aucune, si bien que le routeur aurait reçu les appels du serveur sans savoir lui répondre. Restent deux points que seule une exécution réelle tranchera : que les politiques retenues suffisent à l'API REST, et que l'ensemble passe d'une traite.

**Deux réglages serveur à ne pas manquer au déploiement** : interdire le routage entre pairs WireGuard (`wg0` vers `wg0` rejeté en forward), sans quoi le routeur d'un exploitant atteint l'administration de celui d'un autre ; et sauvegarder `/etc/wireguard` séparément du dump de la base.

### 2026-09-18 — Socle multi-exploitants (Phase 4)

**Vérification** : 24 tests backend + 34 paquet, `tsc` propre, cloisonnement éprouvé contre la vraie base, données préservées à la migration.

- **SOC-1 ✅** : isolation par extension Prisma, contexte par `AsyncLocalStorage`. Piège corrigé : le contexte ne survit pas au passage dans le moteur Prisma — l'exploitant est résolu dans l'accesseur et un client étendu est mémoïsé par exploitant.
- **SOC-2/3/4/7 ✅** : rôles, inscription avec activation, marque, devise. Migration écrite à la main — celle générée aurait supprimé les colonnes de prix au lieu de les renommer.
- **RTR-3 ✅** : épinglage TLS réécrit sur un connecteur `undici`, Node n'appelant jamais `checkServerIdentity` quand la validation est désactivée. Vérifié : une empreinte erronée est refusée.
- Mots de passe sortis du dépôt (seed, `docker-compose`, `.env.example`).

### 2026-09-18 (soir) — Identité GeMikrot et écrans d'accès

- Marque, favicon, connexion et inscription refaites ; inscription en trois étapes avec validation par étape.
- **Deux défauts corrigés** : le client API rechargeait la page sur tout 401, ce qui effaçait le message d'erreur avant son affichage — un mot de passe faux ne produisait rien de visible ; et la connexion traduisait tout échec en « identifiants invalides » alors que le serveur distingue déjà le compte en attente d'activation.

### 2026-09-19 — Garde-fous, paquet MikroTik, offres sur User Manager

**Vérification** : 33 tests backend, 45 paquet, aller-retour complet sur le hAP avec nettoyage.

- **Garde-fous** : `scopedStrict` lève au lieu de dégrader en client non cloisonné ; `rawBody`, `trust proxy`, en-têtes de sécurité. `@nestjs/throttler` écarté : son installation déplace `@nestjs/common` et `core` à la racine du dépôt et l'application ne démarre plus.
- **RTR-9, OFF-2 ✅** : limitations, jonctions, suppression de profil, rotation de mot de passe. **Le mapper des limitations lisait un champ `rate-limit` qui n'existe pas** — une limitation expose `rate-limit-rx` et `rate-limit-tx` séparés. Invisible jusque-là parce que la collection était vide ; trouvé en sondant le routeur.
- **OFF-1/3 ✅** : réconciliation idempotente d'une offre vers profil + limitation + jonction. Le second chemin qui écrivait les mêmes profils (abonnements) a été supprimé.

### 2026-09-19 — Console User Manager, puis analyse des onglets réels

- **OFF-4/5 ✅** : profils, limitations, comptes, avec les comptes hors application étiquetés.
- **Deux défauts trouvés en relevant l'état du routeur** : un compte porte **plusieurs attributions** (une par achat) et le code en retenait une au hasard ; et `end-time` n'a pas de fuseau — le hAP est à +03:00, un backend en UTC aurait avancé toutes les échéances de trois heures, dans le sens qui suspend trop tôt.

### 2026-09-19 — Tickets sur User Manager

**Vérification** : lot de trois tickets créés et attribués, réconciliation sans faux positif, coupure effective ; 646 comptes HotSpot inchangés.

- **TIC-1/2/3/5/6 ✅** : provisionnement dès la génération, validité à la première connexion, expiration réconciliée, répartition par offre, historique HotSpot à part.
- **TIC-4 ✅** : la découverte qui comptait — désactiver un compte ne coupait pas l'accès. Le profil serveur accepte le cookie ; 4 sessions actives sur 4 étaient entrées sans RADIUS, et 46 cookies vivaient sur le routeur. La coupure fait désormais trois gestes.

### 2026-09-19 — Modèle de ticket imprimable

- **TIC-7 ✅ / SECU-4 ✅** : deux gabarits (30 par A4, grand format), éditeur avec aperçu, liste blanche à l'enregistrement. Essai : `<script>` et `onerror` refusés avec le motif.

### 2026-09-19 — Onglets HotSpot et sessions

- **RTR-8/9/10 ✅ / STAT-3 ✅** : Walled Garden administrable, cookies avec purge, serveurs et profils, historique des sessions.
- **Le mapper des sessions lisait `start-time`, `stop-time`, `session-time`** — trois champs inexistants : toutes les sessions ressortaient vides et jamais terminées. RouterOS envoie `started`, `ended`, `uptime`.

### 2026-09-19 — Page de paiement publique

**Vérification** : 65 tests backend, 49 paquet ; parcours complet sans jeton, puis validation admin et code délivré, retrouvé sur le routeur.

- **PUB-1→6 ✅** : vitrine, déclaration, suivi, recherche, bilingue FR/MG, limitation de débit sur clés métier.
- **SOC-4 ✅** : identifiant public (slug) dérivé du nom, unique.
- **Défaut corrigé** : supprimer un compte User Manager **laissait ses attributions** derrière lui — RouterOS y remplace le nom par un identifiant interne, et le profil se croit alors utilisé pour toujours par un compte disparu. Quatre orphelines bloquaient déjà une suppression de profil.
- **Walled Garden posé** : `192.168.88.250:3000` et `:5173`, un port par entrée — RouterOS refuse une liste séparée par des virgules sur cette liste.

---

### 2026-09-20 — Menus IP, stockage, et la clé USB dont tout dépend

**Vérification** : 126 tests paquet, 111 backend, frontend compilé ; les dix lectures éprouvées
contre le hAP réel avant d'être écrites, et les charges relevées figées dans
`tests/mappers/router-ip-menus.spec.ts` et `tests/mappers/router-storage.spec.ts`.

- **RTR-15 ✅** — pare-feu (filtrage et NAT), DNS et entrées statiques, table de routage,
  ajoutés aux cinq écrans de diagnostic existants. Le pare-feu porte une colonne **#** que
  RouterOS ne renvoie pas : elle est déduite de l'ordre de lecture, parce que l'ordre *est* la
  logique — la première règle qui correspond décide, et deux règles identiques placées
  différemment font l'inverse l'une de l'autre. Sur le hAP : 16 règles de filtrage dont 5
  posées par le HotSpot, 19 de NAT, 5 routes dont le tunnel `gemikrot`.

- **RTR-16 ✅** — stockage. Le relevé confirme, chiffres à l'appui, ce que l'exploitant
  décrivait : **280 Kio libres sur 16 Mio** de mémoire interne, soit 1,7 %. Le paquet
  `user-manager` pèse 336 Kio — **il ne tiendrait plus sur le flash interne aujourd'hui**.
  D'où la base sur clé USB : `/usb1-part1/user-manager`, ext4, 930 Mio libres.

- **Ce que cet écran existe pour dire.** La base sur clé est le bon montage — c'est lui qui
  permet à User Manager de tenir le calendrier, une validité continuant de s'écouler quand le
  client se déconnecte, ce que le HotSpot seul ne sait pas faire. Mais il crée une dépendance
  matérielle que rien ne signalait : **clé retirée, base perdue, tous les tickets vendus avec**.
  Le diagnostic place ce cas en tête, avant tout le reste, et distingue « absente » de
  « branchée mais non montée » — pour User Manager les deux se valent, pour le dépannage non.

- **Et la réponse à l'onglet manquant** : User Manager ne fait pas partie de l'image de base de
  RouterOS. Tant que le paquet n'est pas installé, son menu n'apparaît ni dans WinBox ni ici.
  Le constat rend la version et l'architecture exactes — un `.npk` qui ne correspond pas ne
  s'installe pas, et échoue sans le dire — et prévient qu'avec 280 Kio libres il faut faire de
  la place *avant* de téléverser, pas après.

- **Une affirmation fausse retirée avant livraison.** Le commentaire que j'avais écrit disait
  qu'`allow-remote-requests` à `false` empêche le portail de fonctionner. Le hAP est à `false`
  et sert 646 comptes : le HotSpot intercepte le DNS lui-même. L'écran le dit désormais
  explicitement, pour qu'on ne parte pas chercher une panne à cet endroit.

- **Relevé de terrain figé** : `/disk` ne rend **aucun** espace libre sur RouterOS 7.24, même
  pour une partition ext4 montée. Le seul chiffre fiable pour le volume de User Manager vient
  de `/user-manager/database`. Un test le fige pour qu'on ne se remette pas à l'attendre de `/disk`.

- **Tableau RTR remis d'équerre** : RTR-13 y était encore à « reste à éprouver » alors que le
  tunnel a été monté de bout en bout, et RTR-14 à « non livré » alors que comptes, profils,
  serveurs et bassins le sont. La colonne étant le seul suivi qui fait foi, la laisser fausse
  coûte plus cher que de ne rien y écrire.

---

> ⚠️ **Règle d'or** : chaque item livré → vérification sur le routeur réel avec nettoyage,
> charge utile relevée figée dans un test si un mapper est touché,
> **et mise à jour de la colonne « Implémenté » DE CE DOCUMENT** — le seul suivi qui fait foi.
> Avant de démarrer un item : **vérifier le code, pas la colonne.**
