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
| RTR-14 | **PPPoE** en plus du HotSpot : comptes, profils, serveurs et bassins, correspondances écrites contre un relevé réel (`scripts/probe-ppp-sonde.ts`). **Les sessions actives restent non vérifiées** : le parc n'a aucun PPPoE en service, les noms de champs de `/ppp/active` viennent de la documentation seule — le test *et l'écran* le disent | ⭐⭐ | 🔴 | ✅ |
| RTR-19 | **Écran PPPoE** : comptes (création, modification, suspension, suppression), profils, sessions, serveurs, bassins d'adresses. La modification n'écrit que les champs touchés, le nom est figé car il identifie le compte, et un mot de passe vide veut dire « ne pas y toucher » | ⭐⭐ | 🟡 | ✅ |
| RTR-20 | **Génération directe depuis un profil** (« Generate Voucher » de WinBox), côté User Manager comme HotSpot. Profil vérifié avant toute création, échecs partiels nommés plutôt que comptés, 200 par lot au maximum. L'écran dit que ces tickets ne sont pas suivis comme des ventes | ⭐⭐⭐ | 🟡 | ✅ |
| RTR-21 | **Paiements notés par le routeur** (`/user-manager/payment`). Vide sur ce parc, qui encaisse par Mobile Money : les noms de champs viennent des colonnes de WinBox et **non d'un relevé**, et l'écran le dit | ⭐ | 🟢 | 🟡 |
| RTR-15 | **Menus IP en lecture** : files simples (le débit réellement alloué, client par client), journal du routeur, interfaces avec leurs coupures de lien, services d'administration, DDNS, ARP, serveurs DHCP, **pare-feu filtrage et NAT dans leur ordre d'évaluation**, DNS et entrées statiques, table de routage. **Lecture seule, par décision** : la console montre, WinBox modifie | ⭐⭐ | 🟡 | ✅ |
| RTR-16 | **Stockage et préparation de User Manager** : mémoire interne, clés USB et leur état de montage, paquets installés, occupation par support, et où vit la base User Manager. Rend un diagnostic ordonné par gravité, avec la commande exacte quand il en existe une — dont la réponse à « pourquoi l'onglet User Manager n'apparaît-il pas dans WinBox » | ⭐⭐⭐ | 🟡 | ✅ |
| RTR-17 | **Réparations depuis la console**, sans WinBox : allumer le service, activer les profils, programmer l'activation du paquet, annuler une désactivation programmée. **Liste blanche nommée, pas un passe-plat de commandes** — une route exécutant une commande RouterOS arbitraire donnerait à tout ADMIN une exécution de code à distance sur chaque routeur du parc. Le serveur relit l'état après avoir écrit et ne déclare le succès que si le routeur a réellement changé. Redémarrage, déplacement de la base et effacement de fichiers restent affichés comme commandes à coller, jamais comme boutons. **Les trois formes d'écriture éprouvées sur le hAP réel** : constat levé, bouton cliqué, routeur réellement changé, audit écrit, 646 comptes intacts à chaque mesure | ⭐⭐⭐ | 🟡 | ✅ |
| RTR-18 | **Écran Fichiers** : le contenu du routeur trié par taille décroissante, filtrable par support — la seule question qu'on se pose quand 16 Mio de mémoire interne sont pleins à 98 %. Détecte les bases User Manager laissées derrière un déplacement, qui prennent la place *et* ressemblent à la vraie | ⭐⭐ | 🟢 | ✅ |

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
| TIC-9 | **QR code sur le ticket** : encode l'adresse de connexion du portail quand un domaine est déclaré — scanner suffit alors à ouvrir la session — et le code seul sinon. En SVG, pour rester net à 16 mm | ⭐⭐ | 🟢 | ✅ |
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

### 2026-09-20 — Réparer depuis la console, sans WinBox (RTR-17)

**Vérification** : 129 tests paquet, 120 backend, frontend compilé. Routes exposées et
répondant. **Le chemin d'écriture vers le routeur n'a pas pu être éprouvé** : l'outillage
refuse l'écriture depuis ce poste, et il n'a pas été contourné.

- **Liste blanche nommée, et non passe-plat.** Une route qui exécuterait une commande
  RouterOS arbitraire donnerait à tout ADMIN une exécution de code à distance sur chaque
  routeur du parc — le tunnel WireGuard, monté pour administrer, servirait alors à tout.
  Quatre réparations fixes, chacune portant son geste, son critère de réussite et le
  constat qu'elle est censée faire disparaître.

- **Le serveur relit l'état après avoir écrit.** C'est le cœur du service, pas un détail :
  les formes de requête n'ayant pas pu être confrontées au matériel, et RouterOS répondant
  volontiers `200` à une écriture qu'il n'applique pas, déclarer le succès sur l'absence
  d'erreur enverrait chercher la panne ailleurs pendant des heures. Quand le routeur
  accepte sans changer d'état, la console le dit et rend la commande à passer à la main.

- **L'activation d'un paquet se juge sur `scheduled`, pas sur `disabled`.** Un changement
  de paquet ne prend effet qu'au démarrage : vérifier `disabled` déclarerait en échec une
  réparation parfaitement réussie, et la reproposerait indéfiniment.

- **Trou trouvé en préparant la vérification** : une *désactivation* programmée était
  invisible. Le paquet tourne, `disabled` reste faux, et le service meurt au premier
  redémarrage venu — souvent des semaines plus tard, quand plus personne ne fait le lien.
  C'est exactement la classe de panne que cet écran existe pour attraper : ajoutée comme
  constat bloquant, avec l'annulation en un bouton.

- **Ce qui reste volontairement sans bouton** : redémarrer (coupe tous les clients),
  déplacer la base (touche des tickets déjà vendus), effacer des fichiers (suppose de
  savoir à quoi chacun sert), téléverser un `.npk` (ne passe pas par REST). Affichés comme
  commandes à coller, avec leur explication.

- **Un rejeu refusé** : une réparation dont le constat n'est plus présent est rejetée en
  `409` sans toucher au routeur. Un onglet resté ouvert propose encore des réparations
  déjà faites ; les rejouer réécrirait un réglage que quelqu'un a pu changer exprès.

**Deux erreurs trouvées par l'essai de l'exploitant sur le hAP, le même jour.** Toutes deux
invisibles en test, et la seconde aurait envoyé le parc dans la mauvaise direction.

- **`scheduled` est une phrase, pas un code.** RouterOS écrit `scheduled for disable`. Le
  code comparait à `'disable'` : le constat ne se serait jamais levé, et
  `annuler-desactivation` aurait déclaré le succès sans rien faire, sa vérification étant
  « ce n'est plus égal à `disable` » — vrai dès le départ. Lecture sur le contenu
  désormais, et valeur exploitable séparée de la phrase d'affichage.

- **« Disponible » n'est pas « installé ».** La même lecture REST a rendu **3 paquets puis
  19** sur le même routeur. La seconde population est celle des paquets présents dans
  l'image mais jamais installés : version vide, `available` vrai — et `disabled` vrai lui
  aussi, ce qui est le piège. Sur un routeur neuf `user-manager` est exactement dans cet
  état, et la console aurait annoncé « installé mais désactivé » en demandant de
  téléverser un `.npk`. C'est l'inverse du bon geste : le paquet est déjà là, il suffit de
  l'activer et de redémarrer — sans rien libérer sur une mémoire interne pleine à 98 %.
  Quatre états distingués au lieu de trois.

**Éprouvé sur le hAP réel le 2026-09-20**, de bout en bout et sans WinBox pour le geste :

- L'exploitant a programmé la désactivation du paquet depuis WinBox. `/system/package` rend
  alors `scheduled: "scheduled for disable"` — la phrase d'affichage **jusque dans l'API**,
  confirmée par lecture directe. Le relevé est figé dans `router-storage.spec.ts`.
- La console a levé le constat bloquant en tête de liste, avec son bouton.
- Le clic a rendu « Annuler la désactivation programmée : fait. », et une lecture
  indépendante du routeur confirme `scheduled` vide, service allumé, profils actifs.
  **`POST /rest/system/package/unschedule` avec `.id` est donc la bonne forme.**
- L'audit porte la ligne `REPAIR_USER_MANAGER` / `SUCCESS`, attribuée au compte qui a cliqué.
- L'invariant du parc tient : **646 comptes HotSpot** avant et après.

**Le second essai a trouvé l'erreur qui restait.** L'exploitant a posé `use-profiles=no`,
le constat s'est levé, le clic a rendu **500 Internal Server Error** :
`PATCH /rest/user-manager` **n'existe pas**. Le PATCH vaut pour les collections, où il y a
un élément à viser ; un menu singleton veut la commande `set` en POST —
`POST /rest/user-manager/set`. La forme ne se transpose pas, et rien ne le signale.

Corrigé puis rejoué : « Activer les profils : fait. », et une lecture indépendante du
routeur confirme `use-profiles: true`. **Les trois formes d'écriture sont désormais
éprouvées sur le matériel** — `POST <menu>/set` pour les singletons, `POST <menu>/<commande>`
avec `.id` pour les paquets. 646 comptes HotSpot à chaque mesure.

C'est la sixième correspondance de ce projet écrite de bonne foi sur la documentation et
démentie par le matériel. La relecture d'état a fait son travail : la console a montré
l'échec au lieu d'un succès de façade.

- **Écran Fichiers**, ajouté dans la foulée : le contenu du routeur trié par taille
  décroissante, filtrable par support. L'endpoint existait depuis la veille sans être
  affiché. Il a trouvé en s'ouvrant ce qu'aucune lecture ciblée n'avait vu —
  `flash/user-manager5/um5.sqlite`, une base d'avant le déplacement vers la clé, 20 Kio sur
  les 276 Kio libres. Devenu un constat à part entière (`base-orpheline`) : elle prend la
  place qui manque, et surtout elle **ressemble à la vraie** — la restaurer un jour de panne
  figerait les tickets au jour du déplacement. Sans bouton : seule sa date distingue une
  relique d'un secours.

- **Deux finitions de l'interface, dans la foulée.** La barre d'onglets ramène l'onglet
  actif dans le champ de vision : le défaut n'existait pas à cinq onglets, il est apparu en
  les portant à onze — sur un téléphone, on arrivait sur un écran dont l'intitulé était hors
  cadre, sans rien qui paraisse sélectionné. Et les quatorze tables qui affichaient leur
  état vide en ligne grise alignée à gauche passent par un composant partagé, au même ton
  et au même centrage que le reste ; plusieurs en ont profité pour dire *pourquoi* c'est
  vide plutôt que seulement « aucun ».

### 2026-09-20 — PPPoE de bout en bout, et trois doublons supprimés

**Vérification** : 141 tests paquet, 120 backend, frontend compilé, écrans ouverts contre le
hAP réel (2 profils PPP, bassin `pool-hotspot` 245 adresses dont 37 utilisées).

- **RTR-14 ✅ / RTR-19 ✅** — PPPoE existait dans le paquet depuis le relevé de sonde, sans
  aucune route HTTP ni écran. J'avais écrit qu'il n'était pas constructible ; en rouvrant
  les relevés, **quatre des cinq tables étaient déjà éprouvées sur le matériel** —
  `/ppp/profile`, `/ppp/secret`, `/interface/pppoe-server/server`, `/ip/pool`. Seules les
  sessions actives ne l'ont jamais été, le parc n'ayant aucun PPPoE en service. L'écran des
  sessions le dit en clair, plutôt que de laisser croire une colonne vide au routeur.

- **Les boutons de modification.** `updatePppSecret` manquait : on savait créer, suspendre et
  supprimer un compte, pas le modifier. Il **n'écrit que les champs fournis** — renvoyer le
  formulaire entier écraserait au passage le profil, qui porte le débit. Un mot de passe
  laissé vide veut dire « ne pas y toucher », et le nom est figé : il identifie le compte,
  le changer en créerait un autre sans son historique. Création et modification partagent un
  seul formulaire, deux copies divergeant toujours.

- **Trois répétitions supprimées.** *HotSpot ▸ Liaisons IP* montrait en lecture seule ce que
  l'écran Appareils gère réellement — son propre état vide y renvoyait déjà. La table
  « tous les appareils vus » existait sur *Connectés* **et** sur *HotSpot ▸ Hôtes*, la
  seconde en mieux : elle joint le nom du bail DHCP, qui distingue une télévision d'un
  téléphone. Et *HotSpot ▸ « Sessions actives »* portait un nom trompeur — cette table est
  l'historique RADIUS, pas ce qui est en ligne, et le nom entrait en concurrence avec
  l'écran Connectés, qui, lui, l'est. Deux tables pour une même chose finissent par se
  contredire ; celle qui ne sait rien changer perd d'avance.

- **Un défaut de mon test corrigé au passage** : il atteignait le simulacre du paquet par son
  dossier `tests/`. `tsc` refusait de le résoudre — et le backend n'a rien à faire des
  internes de test d'un autre espace de travail. Remplacé par un routeur de laboratoire
  local, qui sait aussi *refuser de changer tout en répondant sans erreur*.

### 2026-09-20 — La coque, et les boutons qui manquaient

**Défaut de disposition, mesuré puis corrigé.** Sur la table des 646 comptes, le document
fait **33 000 px**. La barre latérale, en `static`, s'étirait sur toute cette hauteur : son
`overflow-y-auto` n'entrait jamais en jeu, si bien qu'à mi-page la navigation avait disparu
vers le haut et qu'il fallait tout remonter pour changer d'écran. L'en-tête partait avec,
emportant le sélecteur de routeur et la déconnexion — les deux commandes dont on peut
justement avoir besoin au milieu d'une longue liste. Les deux sont désormais collés ;
vérifié à 4 000 px de défilement, et le tiroir mobile s'ouvre toujours.

*Au passage, une leçon de méthode* : `getBoundingClientRect()` a rendu `-224` sur un élément
dont le style calculé disait `left: 0, transform: none`. Les deux ne peuvent pas être vrais.
La capture d'écran a tranché — le tiroir s'ouvrait correctement. Deuxième fois dans ce
projet qu'une mesure prise isolément contredit ce que l'écran montre : **quand un chiffre et
une image divergent, c'est l'image qui décide.**

**Les boutons manquants du User Manager.** Le backend servait déjà toutes les routes ;
l'interface n'avait pas les commandes. Ajoutés : changer le code d'un compte (rotation sans
perdre le nom, les attributions ni la validité déjà courue), supprimer un compte, modifier
la validité d'un profil, modifier le débit d'une limitation.

Chaque question dit ce que le geste change **vraiment**, parce que les deux modifications
n'ont pas la même portée : changer la validité d'un profil ne touche pas les comptes déjà
attribués — RouterOS fige l'échéance à l'attribution — alors que changer le débit d'une
limitation s'applique à tous ceux qui l'utilisent dès leur prochaine connexion. Et les
suppressions de profil ou de limitation encore rattachées n'ont pas de bouton du tout :
RouterOS refuserait, et un échec est moins clair qu'une absence.

**Éprouvé sur le routeur** : le changement de code sur le compte de test `test1` a rendu
`PATCH /user-manager/user/*2` → **200**. Cela achève la distinction du jour — le PATCH vaut
pour les **collections**, où il y a un `.id` à viser ; c'est sur les **singletons** qu'il
faut `POST <menu>/set`. Les deux formes sont maintenant confirmées sur matériel. Le routeur
masque les mots de passe (`*****`) en lecture, ce qui interdit de relire la valeur : c'est
le journal qui fait foi. 646 comptes HotSpot à la mesure suivante.

### 2026-09-20 — Créer et modifier un compte HotSpot

**Vérification** : 149 tests paquet, 120 backend, **et un cycle complet sur le hAP réel** —
compte d'essai créé (647 comptes), plafond retiré, compte supprimé, parc ramené à ses 646.

**Le périmètre vient des données, pas de la capture.** L'écran de WinBox propose onze champs.
Un relevé des 646 comptes du parc montre lesquels servent : `mac-address`, `address`,
`email`, `routes` et `otp-secret` sont renseignés sur **zéro** compte, tandis que
`limit-uptime` l'est sur **400** — `2h` pour un ticket à 500 Ar. Le formulaire expose donc
cinq champs et non onze : proposer six cases vides à traverser pour en remplir trois n'aide
personne, et écrire des noms de champs qu'aucune donnée ne confirme est exactement le piège
que ce projet a payé six fois.

**Trois relevés figés dans les tests.** `7200s` est accepté et relu `2h`, au format même des
comptes existants. Un plafond absent à la création n'envoie rien — un `0s` donnerait un
compte épuisé d'avance. Et `0s` en modification **fait disparaître le champ**, exactement
comme sur un compte qui n'en a jamais eu : c'est ainsi qu'on retire un plafond. J'avais
écrit ce dernier point en commentaire avant de le vérifier ; le compte d'essai l'a confirmé,
et le commentaire ne l'affirme plus que parce qu'il a été vu.

**La distinction que l'écran doit porter** : le plafond HotSpot compte le temps *passé
connecté* et s'arrête quand le client se déconnecte, là où la validité d'un forfait User
Manager est calendaire et court même hors ligne. C'est la différence entre les deux
produits, et elle est écrite dans le formulaire — la confondre ferait vendre un mois à qui
croyait acheter deux heures, ou l'inverse.

**Non exposé, délibérément** : la création et la modification des *profils* HotSpot. Le
paquet sait les faire, le backend non. Un profil se pose une fois et se règle dans WinBox ;
l'ouvrir ajouterait une surface d'écriture pour un geste rare.

### 2026-09-20 — Générer depuis un profil, et les paiements du routeur

**RTR-20 ✅ — génération directe.** L'équivalent du « Generate Voucher » de WinBox, posé sur
chaque ligne de profil, côté User Manager **et** côté HotSpot. Il comble ce que les lots ne
couvraient pas : la génération existante part d'une *offre* de l'application, donc un profil
présent sur le routeur sans offre correspondante n'avait aucun moyen de produire des tickets.

Trois garde-fous, chacun pour une panne précise :

- **Le profil est vérifié avant toute création.** Un nom mal orthographié produirait sinon
  des dizaines de comptes sans forfait, à retrouver et supprimer un par un.
- **Les échecs partiels sont nommés, pas comptés parmi les réussites.** Côté User Manager la
  création est groupée mais l'attribution ne l'est pas : un compte créé sans profil n'ouvre
  rien, et le faire passer pour un ticket valide se découvrirait au comptoir, devant le client.
- **200 par lot au maximum.** Au-delà, la requête dépasse son délai en laissant des comptes
  créés que l'appelant ne voit jamais.

L'écran dit franchement ce qu'il fait : ces tickets **ne sont pas suivis comme des ventes**,
aucun prix ne leur est rattaché, et ils apparaîtront « hors application ». Un lien renvoie
vers Tickets ▸ Générer un lot pour de la vente suivie.

**Éprouvé sur le hAP** : 3 tickets générés sur `TEST-1H`, préfixe appliqué — comptes créés,
**3 attributions** posées, état `waiting` / `not-yet-running` (validité non démarrée, correct
pour un profil `first auth`). Puis supprimés depuis la console : **0 attribution orpheline**
restante, 3 comptes User Manager et 646 HotSpot comme avant.

### 2026-09-20 — Les lots suivis choisissent leur cible

**TIC ✅ — cible d'un lot.** La génération de lots — celle qui porte un prix et suit chaque
ticket de la vente à l'expiration — ne savait créer que sur User Manager. Elle accepte
désormais le HotSpot, User Manager restant le défaut.

**Le modèle avait une ambiguïté qu'il fallait lever d'abord.** `um_username IS NULL` voulait
dire deux choses : « ticket historique, sans compte tant qu'il n'est pas vendu » **et**
« servi par le HotSpot ». Tant que les lots n'allaient que sur User Manager, la confusion
restait sans conséquence. Elle en aurait une immédiatement avec des lots HotSpot pré-créés :
la vente tenterait de créer un compte qui existe déjà, et la désactivation d'un ticket non
vendu ne couperait rien. D'où une colonne `target` explicite (migration
`20260920160000_voucher_target`), rétro-remplie pour les lignes existantes.

**Ce que la cible change vraiment**, et que l'écran écrit en chiffres avant de générer : sur
User Manager la validité est **calendaire**, elle court client déconnecté ; sur le HotSpot le
plafond posé est `limit-uptime`, du **temps connecté**. Le profil seul ne borne rien — son
`session-timeout` repart à zéro à chaque reconnexion. Un forfait d'un mois devient donc
720 h de connexion réelle, et l'écran le dit en toutes lettres quand la durée dépasse la
journée.

**Trois textes devenus faux, corrigés en les regardant à l'écran** :
« Un forfait d'un mois y devient 2 h » sur une offre de deux heures ; l'avertissement
« ce profil n'existe pas sur le routeur » qui s'affichait en cible HotSpot alors qu'il
interroge les profils *User Manager*, décourageant une action valide ; et « on n'y crée
plus », qui énonçait une règle là où il n'y a qu'un défaut. Le premier message disait aussi
que les comptes seraient créés « sans validité » — `PlanProvisioningService.reconcile` crée
le profil manquant à la génération, ce que le code confirme.

### 2026-09-20 — Ce que l'interface disait mal

**Cinq boîtes du navigateur, toutes posées par moi.** `window.prompt` et `window.confirm`
marchent, et c'est leur seul mérite : ils ignorent la charte, s'affichent en pleine largeur
sur un téléphone, et surtout ils écrasent en texte minuscule ce qui compte le plus — **ce que
le geste change**. Un vendeur lisait « Nouvelle validité en jours ? » sans voir que les
tickets déjà attribués n'en profiteraient pas. Certains navigateurs proposent en prime de
bloquer les dialogues d'une page après quelques-uns, et l'action disparaît alors sans rien
dire.

Remplacées par trois composants. Une confirmation qui **nomme ce qu'on perd** plutôt que de
demander « êtes-vous sûr » — la question n'apprend rien, la conséquence si. Un éditeur à un
champ avec la place d'expliquer sa portée. Et un champ de durée.

**Le champ de durée vient d'un défaut que l'écran a révélé.** Imposer les jours affichait
`0.0104` pour le profil `TEST-1H`, qui dure quinze minutes. Le parc va de 15 min à 30 j :
une seule unité ne peut pas servir les deux bouts. L'unité est désormais choisie d'après la
valeur — la plus grosse qui tombe juste — et en changer **convertit** au lieu de vider :
30 jours deviennent 720 heures, pas un champ blanc.

Le champ a été extrait plutôt que recopié, puis posé aussi sur les deux formulaires de
création qui souffraient du même mal : « Validité (heures) » d'un profil User Manager et
« Plafond de temps (heures) » d'un compte HotSpot. La conversion et le choix de l'unité
étaient exactement la partie qu'on aurait fini par écrire deux fois différemment.

**Éprouvé à l'écran** : `TEST-1H` s'ouvre sur « 15 minutes », `1Mois-15000Ar` sur « 30 jours »,
le compte `H828018` sur « 2 heures » — chacun à son échelle. Rien ne déborde à 375 px.

### 2026-09-20 — L'autre chemin de génération, et la planche qui survit au lot

« À chaque génération » veut dire les deux chemins. La génération brute depuis un profil
déposait sa planche ; celle de l'écran Tickets, non — c'est pourtant la seule qui suit une
vente, et **la seule qui connaît le prix**, désormais imprimé sur le ticket.

**Où garder le chemin.** Le rendre à la volée aurait suffi à l'instant de la génération et à
rien d'autre : un lot produit la veille n'aurait plus eu aucun moyen de retrouver sa feuille,
alors que le PDF, lui, dort toujours sur la clé USB. Les chemins sont donc **portés par le
lot** — une colonne `planches` — et affichés sur l'écran Lots, sous le nom de l'offre. Vide
quand l'écriture a échoué : les tickets, eux, existent quand même.

**Éprouvé sur le vrai routeur** : un lot de deux tickets HotSpot généré depuis l'écran Tickets,
planche écrite en `usb1-part1/tickets/2Heure-500Ar-202609201948.pdf` — 5 074 octets, type
`.pdf file` — et le chemin lu sur l'écran Lots. Lot, tickets, comptes et planche supprimés
ensuite ; 646 comptes HotSpot intacts.

Au passage, `prisma generate` a buté sur `EPERM` : le serveur de développement tenait le moteur
de requêtes. Il faut l'arrêter, générer, puis le laisser repartir — c'est la deuxième fois dans
ce projet.

### 2026-09-20 — La planche A4 écrite sur le routeur

Demandé : un PDF A4 à chaque génération, **enregistré sur le routeur et non dans
l'application**, parce que c'est là que vit la base des comptes. Sondé avant d'écrire une ligne
de conception — et chaque réponse du routeur a changé le dessin :

| Sonde | Réponse du hAP en 7.24.4 | Ce que ça impose |
|---|---|---|
| `PUT /rest/file` `name`+`contents` | **201**, contenu relu octet pour octet, rangé en `.pdf file` | c'est le canal |
| `/tool/fetch` | **500** — `not enough permissions (9)` | pas de téléchargement par le routeur |
| `contents` à 82 800 octets | **400** — `failure: contents too long` | … |
| dichotomie 32 k → 64 k | limite entre **61 250 et 61 500** | **60 Kio**, une planche par fichier |
| flash interne | **278 Ko libres sur 16 Mo** | impossible d'y écrire |
| `usb1-part1` | **975 Mo libres** | c'est là que ça va |

Trois conséquences que ces chiffres dictent, et qu'aucune bibliothèque PDF ne donne :

1. **Le fichier doit être ASCII.** `contents` voyage dans du JSON : un octet au-delà de 127
   serait réencodé en UTF-8 en route. Donc aucune police ni image embarquée, les accents en
   **échappement octal** — `(é)` pour « é » — et les flux **compressés puis réencodés en
   ASCII85**, un couple de filtres que le format porte depuis toujours.
2. **Le QR est dessiné en vecteur**, pas en image : une image serait binaire. Les modules
   sombres voisins sont fondus en un rectangle par série — sans cela une planche de trente
   tickets dépassait encore la limite une fois compressée.
3. **Une planche par fichier.** Mesuré : 30 tickets avec QR d'URL = 54 456 octets, 60 = 108 540.
   Le découpage est donc **vérifié sur le PDF produit**, pas seulement sur le nombre par page :
   un nom d'offre long ou un domaine de portail changent le poids.

Le fichier atterrit dans `usb1-part1/tickets/`, nommé d'après le profil et l'horodatage — deux
lots du même profil le même jour ne s'écrasent pas. **Un échec d'écriture n'annule jamais les
tickets** : ils sont déjà sur le routeur quand la planche part, et sept feuilles moins une
valent mieux que rien.

**Second point demandé : la validité en heures.** Les offres de ce parc s'appellent
« 2Heure-500Ar » ; un ticket qui annoncerait « 30 j » obligerait le vendeur à convertir devant
le client. L'écran Offres et le ticket imprimé disent maintenant `2 h`, `24 h`, `168 h`,
`720 h`. `formatDuration`, qui choisit l'unité la plus naturelle, reste juste ailleurs — un
temps consommé n'est pas une validité vendue.

**Éprouvé bout en bout** : trois tickets générés sur le vrai routeur, planche écrite en
`usb1-part1/tickets/2Heure-500Ar-202609201939.pdf`, **6 825 octets sur le routeur pour 6 825
envoyés**, type `.pdf file`. Comptes et planche supprimés ensuite, 646 comptes intacts.

**Ce qui n'est pas éprouvé** : RouterOS ne rend pas le `contents` d'un fichier de cette taille,
je n'ai donc pas pu relire ces 6 825 octets pour les comparer. Ce qui l'est : un PDF de
623 octets a fait l'aller-retour caractère pour caractère, et le même générateur produit des
planches qui s'ouvrent et s'impriment correctement en local.

### 2026-09-20 — `*10` dans la colonne « Compte »

Parti pour écrire le miroir du contrôle précédent — les comptes du routeur qu'aucun ticket ne
réclame — et tombé sur autre chose en chemin.

La liste des comptes User Manager rendait **21 comptes** à une mesure, **3** à la suivante. Avant
de conclure quoi que ce soit :

- **le journal d'audit ne montre aucune suppression** depuis des heures, et seulement mes propres
  artefacts nommés (`ZZ-*`, `ZZT-*`) ;
- **la clé USB est montée et la base saine** : `/usb1-part1/user-manager`, 172 Ko, 975 Mo libres,
  paquet installé et actif ;
- **les attributions rendent toujours 21 lignes**, et les profils comptent toujours 16 + 2.

Les comptes n'ont donc pas « disparu » du routeur d'un bloc : ils ont disparu de
`/user-manager/user`, en laissant leurs attributions derrière eux. **Ce que la console faisait de
ces orphelines est le vrai défaut**, et il ne dépend pas de la cause :

```
Compte        Profil           État
*7            2Heure-500Ar     waiting     ← lu comme un nom de compte
*10           4Heure-1000Ar    waiting
```

RouterOS résout `user` en **nom** tant que le compte existe, et rend l'**identifiant brut** une
fois qu'il a disparu. La console écrivait donc `*10` dans une colonne intitulée « Compte », avec
une pastille d'état grise, comme un compte ordinaire en attente. Et l'écran Profils les comptait
: « **16 comptes** » pour seize fantômes.

Elles sont désormais nommées — « référence *10 », pastille rouge « compte disparu », bandeau
d'explication — et **décomptées à part** : « 0 + 16 disparu(s) ».

**Une conséquence que la vérification à l'écran a rattrapée.** Exclure les orphelines du nombre
de comptes — ce qu'elles méritent — a fait tomber `accountCount` à zéro, et donc **apparaître le
bouton « Supprimer »** sur deux profils encore référencés seize fois. La garde tient compte des
deux désormais. C'est le genre de dégât qu'on ne voit pas en relisant son propre diff.

### 2026-09-20 — « 10 tickets disponibles », pour 602 dans le tiroir

La Vue d'ensemble annonce ce qu'elle est : « ce qu'il faut savoir en ouvrant la console : ce qui
est encaissé, **ce qui reste à vendre**, et ce qui demande une décision ». Sa tuile « Tickets
disponibles » affichait **10**.

Compté sur le routeur :

```
comptes HotSpot            646
  suivis par la console     14
  hors application         632
  jamais connectés         602   ← 302 × 2Heure-500Ar + 299 × 4Heure-1000Ar + 1
```

**L'exploitant lisait le soixantième de son propre stock.** La console ne suit que ce qu'elle a
créé elle-même — c'est légitime — mais elle présentait ce compte partiel sous un titre qui
promet le tout.

Deux tuiles désormais, **côte à côte et jamais additionnées** : « Tickets suivis ici » (la base,
avec son suivi vente-expiration) et « En stock sur le routeur » (les comptes jamais connectés).
Les additionner serait faux dans les deux sens : un ticket imprimé et perdu compte dans l'un et
pas dans l'autre, un ticket créé pour un autre routeur compte dans l'autre et pas dans l'un.

Les deux nombres viennent de deux sources qui n'ont pas les mêmes pannes, et sont donc lus par
**deux requêtes séparées** : mêlées dans un seul appel, un câble débranché emporterait tout le
tableau de bord.

**Éprouvé dans les deux états** : routeur joignable, « 602 — comptes jamais utilisés sur 646 » ;
routeur refusant les identifiants, « non lu », le reste du tableau de bord intact. Une
inexactitude de ma part corrigée au passage : l'indice disait « le routeur ne répond pas »
alors qu'il répondait et refusait — il dit maintenant « lecture impossible », la cause exacte
étant déjà nommée par le bandeau du haut.

### 2026-09-20 — Un ticket « vendu » que rien ne porte

Confronté la base au routeur, ticket par ticket et abonnement par abonnement. **Aucun désaccord
sur les suspensions** : les quatorze abonnements et les huit tickets réels concordent avec ce
que le routeur applique. C'est une bonne nouvelle qui mérite d'être écrite.

Mais **cinq tickets n'ont aucun compte derrière eux**, dont un marqué `SOLD`. Si c'était une
vraie vente, le client a payé et son code n'ouvre rien — pendant que la console affiche
« vendu » comme si tout allait bien.

La réconciliation aurait dû les trouver. Elle avait deux trous :

```ts
where: { umUsername: { not: null }, ... }   // les non-provisionnés exclus d'emblée
...
if (mine.length === 0) continue;            // le compte absent, passé sous silence
```

Le premier filtre excluait précisément les tickets que ce contrôle devait trouver : un ticket
jamais posé sur le routeur n'a pas d'`umUsername`. Le second rencontrait un compte disparu et
passait au suivant sans un mot.

Trois cas distingués désormais, parce qu'ils ne se cherchent pas au même endroit : un ticket
**User Manager** par ses attributions, un ticket **HotSpot** par la table du HotSpot — ne lire
que les attributions revenait à le déclarer absent — et un ticket **sans cible**, qui n'a jamais
été posé nulle part. Un ticket annulé sans compte reste normal et n'est pas signalé.

**Éprouvé sur le routeur** : le bouton « Actualiser depuis le routeur » rend maintenant
« 5 ticket(s) sans compte » avec les codes, dont le `SOLD`. Le sixième, annulé, est
correctement ignoré. Cinq tests neufs sur un service qui touche à l'argent et n'en avait aucun.

### 2026-09-20 — Une offre vendable dont le profil n'existe plus

Confronté les huit offres de l'application aux profils du routeur. Les durées concordent
partout — pas de fuite de ce côté. Mais **une offre désigne un profil absent du routeur** et
reste « actif », donc vendable.

Sondé plutôt que supposé : créer un compte HotSpot avec un profil inexistant rend un **400**.
Rien n'est créé, l'échec est franc — mais il arrive **au comptoir**, une fois par ticket : un
lot de cinquante échoue cinquante fois, devant le client. (Au passage, la réponse lue était
« Le routeur a répondu une erreur — RouterOS a répondu 400 » : le filtre d'exception écrit ce
matin fait son travail sur un cas que je n'avais pas construit.)

Le formulaire de génération vérifiait déjà le profil **User Manager** avant de lancer, avec un
message rouge explicite. Le côté **HotSpot** n'avait rien. Le contrôle est désormais symétrique.

Et surtout, l'écran Offres confronte maintenant chaque offre au routeur : pastille rouge
« absent du routeur » sur la ligne, bandeau au-dessus de la table. On attrape le défaut là où il
naît — un profil renommé ou supprimé dans WinBox — et non à la vente. L'absence de réponse du
routeur ne conclut rien : on ne dit « introuvable » que si le routeur a répondu.

Deux restes du même écran, corrigés en passant : le champ de validité demandait des **secondes**
— une offre de deux heures s'y saisissait « 7200 » — alors que le composant partagé qui choisit
l'unité existe depuis ce matin ; et la colonne Validité affichait « 720 h » pour un forfait au
mois, exact et illisible. Elle lit maintenant « 30 j ».

**Note sur les données** : les six tickets rattachés à cette offre datent du 18 septembre et
n'ont jamais atteint le routeur (`target` vide, pas de compte). Je ne les ai pas touchés —
effacer des lignes d'une base de production n'est pas une décision à prendre à la place de
l'exploitant. 646 comptes intacts.

### 2026-09-20 — 228 tickets dans le tiroir, sans plafond

Parti des MAC aléatoires, arrivé ailleurs. La mesure intermédiaire : **28 des 59 cookies
portent une MAC aléatoire**, et sept comptes en cumulent deux ou trois. En cherchant ce que
cela coûte au client, j'ai relu les profils du routeur — et c'est là qu'était le vrai défaut.

Un ticket HotSpot est borné par deux choses qui n'ont rien à voir :

- le **`session-timeout`** du profil, qui **repart à zéro à chaque reconnexion** ;
- le **`limit-uptime`** du compte, qui cumule.

Avec `mac-cookie`, la reconnexion est automatique. Sans `limit-uptime`, un ticket de deux heures
sert donc deux heures **par session**, sans fin.

Relevé sur le parc :

```
2Heure-500Ar    328 comptes    228 sans plafond    ← tous à compteur zéro : invendus
4Heure-1000Ar   300 comptes      0 sans plafond
```

Les 100 comptes « 2 heures » déjà utilisés portent tous `limit-uptime: 7200`. Les 228 autres,
aucun. **Deux chemins créaient des tickets HotSpot, et un seul posait le plafond** :
`provisionOnHotspot`, dans l'écran Tickets, le pose — avec un commentaire qui explique
pourquoi ; `genererHotspot`, la génération par lot, ne le posait pas. Les 228 sont des tickets
invendus, en attente dans le tiroir : ils sous-factureront à la vente.

La durée est désormais **reprise du profil** — ce que l'exploitant a écrit lui-même en créant
« 2Heure-500Ar » — et non inventée. Quand le profil n'en porte aucune, on ne devine pas : le
résultat le dit, et l'écran de génération affiche un avertissement.

Le correctif ne vaut que pour les prochains. Pour ceux déjà créés, l'écran Comptes montre
maintenant le détail, **par profil et non en un seul nombre** — « 242 » recouvrait des cas de
poids très différents :

```
228 × 2Heure-500Ar            plafond à poser : 2 h
 12 × 1Mois-15000Ar           plafond à poser : 30 j
  1 × Ticket 25000Ar-2App.    plafond à poser : 30 j
  1 × 1MoisPremium-50000Ar    plafond à poser : 30 j
```

**Le bouton n'a pas été actionné.** 242 écritures sur un routeur en production ne se décident
pas à la place de l'exploitant ; la capacité est là, le choix lui revient. 646 comptes intacts.

### 2026-09-20 — Huit cookies que personne ne pouvait voir

Une mesure, pas une intuition : **59 cookies pour 10 sessions**. Quarante-neuf reconnexions
latentes. Croisés avec les comptes du routeur, ils se répartissent ainsi :

```
actif   51      bloque   7      absent   1
```

**Sept cookies appartiennent à des comptes délibérément bloqués**, et un à un compte qui
n'existe plus. Les sept sont les victimes du défaut corrigé le même jour : bloquer un compte
laissait ses cookies en place. Ils étaient introuvables — la liste ne classait rien, et ce qui
appelle un geste se perdait dans une cinquantaine de lignes toutes pareilles.

**Ce que je n'affirme pas** : que RouterOS honore le cookie d'un compte désactivé. Le savoir
demanderait un appareil client, et je ne l'ai pas éprouvé. Mais un reliquat qu'on ne peut ni
voir ni effacer est un doute permanent, et l'effacer ne coûte rien à un client en règle, qui
retape son code. La console les montre donc, groupés en tête de liste, avec un effacement d'un
geste.

**Je n'ai pas cliqué dessus.** Ce sont les cookies de vrais clients ; construire la capacité
est mon travail, décider de s'en servir est celui de l'exploitant.

Une observation au passage, gardée pour plus tard : plusieurs de ces adresses MAC portent le
bit « administrée localement » (`4E:`, `16:`, `E2:`, `06:`, `E4:`). Ce sont des **MAC
aléatoires**, celles que les téléphones récents changent par réseau. Un client qui fait tourner
sa MAC laisse un cookie derrière lui à chaque rotation — ce qui explique une partie du volume,
et mériterait son propre examen.

### 2026-09-20 — « Déconnecter », et le client revient dix secondes plus tard

Relevé sur le routeur, pas supposé — les dix sessions en cours, avec leur mode d'entrée :

```
BELLO25-07  mac-cookie     PapaDuran  mac-cookie     Faniry       mac-cookie
Malala      mac-cookie     kenny      mac-cookie     Soaragnetre  mac-cookie
Mamasy      cookie         Herizo     mac-cookie     Lalaina      mac-cookie
H830756     http-pap
```

**Neuf sur dix sont entrées par cookie.** Une seule a tapé un code. Or l'écran Connectés
n'offrait qu'un bouton, « Déconnecter », qui ferme la session sans toucher au cookie : le
client se reconnecte seul en quelques secondes, sans rien retaper et sans que User Manager soit
consulté. L'écran se rafraîchit toutes les dix secondes — **l'exploitant regardait la ligne
revenir**. C'est le genre de détail qui fait douter de toute la console.

La colonne MAC, qui ne disait rien à personne à cet endroit, a cédé la place à « Entré par ».
Neuf pastilles ambre, une verte : la couleur dit le geste à faire. Et deux boutons, parce
qu'ils ne veulent pas dire la même chose — **déconnecter libère la place, couper empêche de
revenir**. Escalader l'un vers l'autre en silence forcerait un client en règle à retaper son
code.

**Supprimer un compte était pire que le bloquer.** Effacer le compte ne fermait pas la session
et ne touchait pas aux cookies ; le client restait en ligne. Et une fois le compte disparu,
**il n'y a plus de nom à qui rattacher la coupure** — plus moyen de rattraper l'oubli depuis
cette console. L'ordre compte : couper tant que le compte existe, supprimer ensuite.

**Éprouvé** : l'écran affiche bien neuf « cookie » et un « code saisi », exactement ce que rend
le routeur. Je n'ai cliqué sur aucun des deux boutons — ces dix sessions sont de vrais clients
en train de naviguer ; le chemin de coupure a été éprouvé au tour précédent sur un compte
jetable. 646 comptes, 57 cookies, 10 sessions : rien touché.

### 2026-09-20 — Trois boutons « Suspendre » qui ne suspendaient pas

Le défaut le plus cher de la journée, et il ne se voyait pas à l'écran.

`RouterAccessService` porte, depuis un relevé sur le routeur, ce que coûte une coupure :
désactiver un compte **ne coupe rien tout de suite**. La session en cours n'est pas fermée, et
le profil serveur de ce parc accepte `mac-cookie` avec une durée de vie de **trois jours** — le
client se reconnecte alors sans repasser par RADIUS, donc sans que le compte désactivé soit
consulté. Deux des six sessions relevées étaient entrées ainsi, `radius: false`.

Le travail planifié le savait : il appelle `revoke`, qui désactive **et** ferme la session
**et** efface les cookies. Trois boutons, non :

| | avant | après |
|---|---|---|
| HotSpot ▸ Comptes ▸ Bloquer | `setHotspotUserDisabled` | + session fermée, cookies effacés |
| User Manager ▸ Suspendre | `setUserManagerUserDisabled` | idem |
| Abonnements ▸ Suspendre | `setUserManagerUserDisabled` | `revoke` |

**L'exploitant qui cliquait obtenait une coupure plus faible que celle qui serait arrivée toute
seule quelques heures plus tard.** Un abonné impayé suspendu à la main gardait son accès
jusqu'à trois jours.

L'écran HotSpot décrivait pourtant le piège — « une suspension côté User Manager ne les coupe
pas » — mais sur l'onglet **Cookies**, loin du bouton qui échouait, et derrière une action
séparée « Couper l'accès » qu'il fallait penser à aller chercher. **Documenter un piège n'est
pas la même chose que ne pas en avoir.**

Ce qui a été réellement coupé est maintenant rendu et affiché, **y compris quand c'est zéro** :
« aucune session en cours, aucun cookie à effacer » n'est pas un non-événement, c'est ce qui
permet d'être sûr que le client est hors ligne au lieu de le supposer.

**Éprouvé sur le routeur** avec un compte HotSpot jetable créé pour l'occasion et un compte
User Manager d'essai : les deux rendent leur compte rendu, et l'écran l'affiche. La fermeture
d'une **vraie** session n'a pas été éprouvée ici — les 57 cookies et la session vivante du
routeur appartiennent à de vrais clients — mais c'est le chemin que le travail planifié
emprunte depuis toujours, et il a ses propres tests. Compte jetable supprimé, compte d'essai
réactivé, 646 comptes et 57 cookies intacts.

### 2026-09-20 — Le squelette qui tournait sans fin

Fin de la traque. Sur les quatre écrans qu'il me restait à éprouver, **trois étaient déjà
corrects** — Journal, Paramètres et Vue d'ensemble disent l'échec. Mon triage précédent, qui
comptait les occurrences d'`isError` par fichier, les avait signalés à tort.

Le quatrième avait la pire variante du défaut. « Modèle de ticket » attendait sur
`templates.isLoading || !draft`. Le brouillon est posé par un effet à partir du premier modèle
lu ; **si la lecture échoue, il n'y a pas de modèle, donc pas de brouillon, donc la condition
reste vraie pour toujours**. L'écran tournait sans fin, sans bouton, sans un mot — pire qu'une
table vide, qui au moins s'arrête.

Sur la feuille d'impression, `templates.data![0].id` sur une liste vide rendait `undefined.id`,
et l'échec s'affichait « Erreur inconnue » pour une situation qui se nomme très bien. Le
bouton « Préparer la feuille » se gardait de `!templates.data` mais **pas d'un tableau vide**.
Et le compteur annonçait « 0 ticket à vendre » sans réponse du serveur, sur l'écran où l'on
vient justement imprimer : on repart en croyant n'avoir rien à vendre.

Dernier point vu à l'écran et non dans le code : les retours anticipés sautaient l'en-tête. On
tombait sur un bandeau rouge flottant, sans titre ni explication de l'écran où l'on se trouve.
Il se rend maintenant dans tous les cas.

**Éprouvé** serveur arrêté : l'écran s'arrête sur un message avec son titre, le bouton
d'impression est fermé, le compteur dit « non lu ». Serveur relancé : l'éditeur revient
entier, 646 comptes HotSpot.

### 2026-09-20 — Quand la console niait les registres de l'entreprise

Le même défaut, mais sur les données de la console elle-même. Clients, paiements, offres,
abonnements, tickets : sept écrans affichaient une table vide quand la lecture échouait. «
Aucun client », « 0 ticket(s) » — **la console niait les registres de l'entreprise**, pour un
serveur qui redémarre.

La différence avec une table lue sur le routeur tient en une phrase, et c'est celle qu'il faut
entendre en premier : **ces données sont en base et n'ont pas bougé**. Ne pas pouvoir les lire
ne dit rien de leur existence. D'où un bandeau distinct, dont la tournure évite l'accord —
« Impossible de lire les offres » comme « les clients » — plutôt que de le confier à chaque
appelant, où il finirait par se tromper.

`BatchesPage` le faisait déjà, seul des huit. Le compteur a déménagé vers `ui.tsx` : il n'a
jamais rien eu de propre au routeur, une caisse compte ses tickets comme un routeur ses
comptes.

**Deux tables de statuts avaient divergé.** L'écran Tickets — le plus consulté de la console —
avait gardé les siennes quand les six autres étaient passés à `libelles.ts`. Un ticket coupé s'y
lisait « désactivé », et un ticket annulé y était **rouge** : or le rouge veut dire « quelque
chose à faire », et une annulation ne demande rien. C'est précisément ce qu'une source unique
existait pour empêcher.

**Éprouvé pour de bon** : serveur arrêté, les quatre écrans disent la bonne phrase avec un
bouton « Réessayer » et le compteur dit « non lu » ; serveur relancé, 14 tickets affichés,
statut « coupé », et 646 comptes HotSpot.

### 2026-09-20 — Le même défaut, cherché partout plutôt qu'écran par écran

Un comptage : requêtes contre gestion d'erreur, fichier par fichier. **`UserManagerPage` :
huit requêtes, zéro.** C'est l'écran du seul mécanisme qui compte le temps calendaire, celui
dont tout le modèle commercial dépend.

Ses trois tables avaient le défaut exact de l'écran Appareils : sans réponse du routeur, `data`
reste vide, les lignes ne s'affichent pas, et la ligne « aucun profil sur ce routeur » ne
s'affiche pas davantage — sa garde comparant `undefined` à zéro. Une table à en-têtes, sans un
mot. **Ici, en conclure que les profils ont disparu envoie restaurer une sauvegarde pour une
panne de lien.** Même chose pour « 0 compte » affiché sans condition.

**Une troisième copie** de la table lue en direct dormait dans l'écran PPPoE — j'en avais
trouvé deux. Les trois sont parties ; le bandeau d'échec est séparé du composant, pour les
tables dont le balisage par ligne ne peut pas l'adopter mais qui doivent dire l'échec pareil.

**`w-auto` n'a jamais rien fait.** Trois écrans le passaient à un champ pour le dimensionner à
son contenu. `FIELD_BASE` commence par `w-full` ; les deux classes ont la même spécificité, et
c'est l'ordre de la feuille de style qui tranche, pas celui de l'attribut. Le défaut gagnait à
chaque fois. Invisible dans une cellule de tableau, qui contraint déjà la largeur — bien
visible sur le filtre du User Manager, où le champ poussait son étiquette à la ligne. Une
largeur demandée par l'appelant l'emporte désormais.

Restait `waiting`, recopié tel quel de RouterOS dans une colonne intitulée « État ». Le
traduire a fait apparaître une redite : « pas encore utilisé » se lisait alors dans deux
colonnes voisines. L'échéance ne porte plus que des dates.

**Éprouvé** sur un routeur d'essai aux identifiants refusés — les trois tables nomment la bonne
cause, le compteur dit « non lu » — puis sur le vrai routeur : 11 comptes User Manager
affichés, filtre sur une seule ligne, et 646 comptes HotSpot.

### 2026-09-20 — « Internal server error » pour une coupure de courant

Parti d'une mesure. Un routeur injoignable, quatre appels : **16 s, 16 s, puis 12 ms**. Le
disjoncteur fait son travail. Mais les corps de réponse ne se ressemblaient pas du tout.

```
appel 1  500  {"statusCode":500,"message":"Internal server error"}
appel 3  503  {"message":"Routeur « X » injoignable — Timeout après 5000ms
                pour GET /ip/dhcp-server/lease (nouvelle tentative dans 21 s)"}
```

**La même panne donnait deux réponses opposées, et la pire arrivait en premier.** Le message
exact n'existe qu'une fois le disjoncteur ouvert, c'est-à-dire après deux échecs et trente
secondes d'attente. Les premiers appels — ceux que l'exploitant voit justement au moment où la
panne commence — rendaient la phrase que NestJS réserve à un défaut de la console elle-même.
On cherche alors le problème du mauvais côté.

Il n'existait **aucun filtre d'exception** : toute erreur MikroTik remontée jusqu'au
contrôleur devenait `500`. Pas seulement les pannes de lien — un mot de passe refusé par le
routeur aussi. Le filtre traduit désormais la hiérarchie entière : **503** pour un lien
tombé (le code que rendait déjà le disjoncteur, les deux concordent enfin), **502** pour un
routeur qui répond et refuse, **404 / 400 / 409** pour ce que la demande justifie. Aucun de
ces messages ne porte de secret : les identifiants voyagent dans un en-tête `Authorization`,
jamais dans l'URL, et le texte ne contient que la méthode et le chemin RouterOS — lequel est
précisément ce qui permet de dire où regarder.

**Les écrans disaient tous la même chose.** « Le routeur n'a pas répondu », quel que soit
l'échec — y compris quand le routeur avait parfaitement répondu et refusé nos identifiants.
On envoyait vérifier un câble pendant que le remède était un compte à corriger. Le code brut
traverse maintenant jusqu'au client, et une seule fonction le traduit.

Deux silences trouvés en éprouvant cela, tous deux sur l'écran HotSpot :

- **L'onglet Serveurs rendait une page entièrement blanche.** `if (!data) return null` — et
  c'est l'onglet par défaut. Rien n'indiquait qu'une lecture avait eu lieu, encore moins
  qu'elle avait échoué : on pouvait en conclure que le HotSpot n'était pas configuré.
- **« 0 compte(s) » à côté d'une table en échec.** La longueur d'un tableau vide faute de
  réponse, écrite sans condition. Le routeur en portait 646. C'est pire qu'une table blanche :
  un chiffre a l'air d'un constat.

Au passage, la table lue en direct existait en **deux exemplaires identiques**, un par écran
de configuration. Deux copies veulent dire deux endroits où corriger une phrase — et c'est
exactement ce qui était arrivé.

**Éprouvé sur le vrai routeur**, avec de vrais mauvais identifiants : 502 en 0,4 s, et l'écran
nomme la bonne cause. Puis un hôte injoignable pour le 503. Routeur d'essai supprimé, comptes
HotSpot toujours à 646.

### 2026-09-20 — L'écran Appareils disait « bloqué » de ce qui marchait

**Rouge sur un téléphone qui va bien.** La colonne lisait `bypassEnabled` et n'en tirait que
deux issues : vrai → « Actif », faux → « Bloqué » en rouge. Or faux recouvre deux situations
**opposées**. Un appareil jamais contourné — l'immense majorité — passe par le portail comme
tout le monde et fonctionne parfaitement ; le dire bloqué envoie chercher une panne qui
n'existe pas. Un appareil dont le contournement a été coupé garde un `ip-binding` de type
`blocked` sur le routeur : là, son trafic est jeté et il n'atteint même pas la page de
connexion. `mikrotikBindingId` les sépare exactement — il n'existe que si un contournement a
été créé un jour. Trois états désormais : **passe sans portail**, **passe par le portail**,
**bloqué au routeur**, et le bouton suit — « Rétablir » plutôt qu'« Activer » sur un appareil
bloqué, parce qu'il remet un binding existant et n'en crée aucun.

**La table qui se taisait.** Quand le routeur ne répondait pas, la découverte échouait, `data`
restait vide — et la ligne « aucun bail DHCP visible » ne s'affichait pas davantage, sa garde
comparant `undefined` à zéro. On lisait une table à en-têtes, sans une ligne ni un mot : ce
qui se confond avec « aucun appareil sur le réseau », **la conclusion inverse de la vraie**.
Même silence sans routeur choisi, la requête restant désactivée. Les deux cas sont dits, et
l'erreur rappelle ce qui continue sans la console : les contournements en place tiennent,
c'est le routeur qui les applique.

**Ce que valait la proposition.** Le serveur calcule une fiabilité pour chaque type proposé ;
l'écran la jetait. Un nom DHCP reconnu (« Galaxy-A11 ») et un préfixe de fabricant qui ne dit
rien du type arrivaient sans nuance — et le second propose toujours « indéterminé ». C'est
pourtant le seul renseignement qui compte au moment où l'on demande à l'admin de confirmer ;
sans lui, confirmer devient un réflexe. Elle s'affiche : **nom reconnu** ou **simple
supposition**.

Restaient les types en anglais brut — `PHONE`, `TV`, `CAMERA` — jusque dans la liste
déroulante, et une table d'appareils enregistrés identifiés par leur seule adresse MAC alors
que le nom DHCP était en base. L'ambre sur télévision et caméra n'est pas décoratif : ce sont
les deux types dépourvus de navigateur, ceux qui ne passeront jamais sans contournement.

**Éprouvé à l'écran**, les trois états côte à côte sur des lignes d'essai, puis un routeur
d'essai pointé sur une adresse injoignable pour voir la branche d'erreur ; lignes et routeur
supprimés ensuite, et les comptes HotSpot toujours à 646.

### 2026-09-20 — L'écran Routeurs et le raccordement

Trois défauts, trouvés en regardant ces écrans plutôt que leurs API.

**L'écran qui ne demandait rien.** La joignabilité est tenue en mémoire par le serveur et
n'est alimentée qu'**en effet de bord** d'autres appels : après un redémarrage, tout le parc
affichait « pas encore interrogé ». L'écran dont le métier est de dire si les routeurs
répondent était le seul à ne pas leur demander, et laissait cliquer « Tester » pour une
réponse qu'il pouvait aller chercher. Il sonde maintenant à l'ouverture, **une fois et
seulement les états inconnus** : un routeur déclaré injoignable l'a été par une vraie
tentative, la répéter ne ferait qu'attendre le délai à chaque affichage.

**Le script qui ne valait que sur ce réseau.** L'invitation rendait un script pointant vers
`192.168.88.135` — l'adresse locale du poste, celle-là même dont le changement de bail DHCP
avait coûté une heure de dépannage de tunnel plus tôt dans ce projet. Remis à un exploitant
dont le routeur est ailleurs, il échoue **en silence** : WireGuard n'a personne à qui parler,
les octets sortants montent, les entrants restent à zéro. La console pose maintenant ce
diagnostic **avant**, pas après : une adresse privée déclenche un avertissement nommé, avec
l'adresse en question et le réglage à corriger. Un nom de domaine est présumé public sans
être résolu — résoudre depuis le serveur ne dirait rien de ce que verra le routeur.

**Les invitations invisibles.** `enrollmentsApi.pending()` existait dans le client sans
qu'aucun écran ne l'affiche : on préparait un script, on quittait la page, et plus rien ne
disait qu'un raccordement était en cours ni qu'une adresse de tunnel restait réservée. Elles
sont listées, avec leur adresse et leur échéance — et **annulables**, ce qui n'existait pas
non plus : un script préparé par erreur occupait son adresse trente minutes. L'annulation ne
touche que ce qui n'a jamais abouti ; une invitation consommée a produit un routeur, et
l'effacer effacerait la trace de son raccordement.

**Éprouvé** : serveur redémarré, l'écran affiche « joignable » dès son ouverture ; deux
invitations d'essai créées, l'avertissement s'affiche avec la bonne adresse, puis annulées
depuis la console — la carte disparaît quand elle est vide.

### 2026-09-20 — Ce que les écrans quotidiens disaient en anglais

Passé sur les écrans les plus consultés au comptoir, ceux que j'avais le moins regardés.

**Une phrase cassée sur la Vue d'ensemble.** La bannière collait un libellé de pastille
derrière « est » : « Le routeur X **est pas encore interrogé** ». Un libellé de badge n'est
pas un morceau de phrase, et vouloir les confondre casse toujours sur le cas qu'on n'avait
pas en tête. Chaque état porte désormais ses deux formes.

**Un message d'erreur écrit pour un développeur, et périmé.** L'écran Connectés renvoyait
à `MIKROTIK_BASE_URL` dans un fichier `.env`. Doublement inutile : un vendeur au comptoir
n'en peut rien faire, et ces variables ne sont plus le mécanisme depuis que les routeurs
vivent en base avec leurs identifiants chiffrés. Il dit maintenant ce qui **continue de
marcher sans la console** — les clients connectés ne sont pas coupés — et renvoie vers
l'écran Routeurs.

**Des valeurs brutes sur six écrans.** `PENDING`, `SOLD`, `ORANGE_MONEY`, `synchronized`.
Les libellés vivaient dans les écrans qui les affichaient : chacun retraduisait à sa façon,
et ceux qu'on regardait moins — la fiche client, les offres — restaient en anglais. Un seul
module les porte maintenant, ton compris : les deux se décident ensemble, et se tromper de
couleur envoie chercher un problème qui n'existe pas. « Annulé » et « remboursé » passaient
en rouge comme un refus alors qu'ils ne demandent rien à personne.

La fonction de traduction **laisse passer ce qu'elle ne connaît pas**. Un statut ajouté
côté serveur sans l'être ici doit rester lisible, fût-ce en anglais : une case vide serait
pire.

**Deux mots choisis plutôt que traduits** : « NTP / synchronized » devient « Horloge / à
l'heure » — c'est l'horloge du routeur qui décide des échéances, et une horloge à la dérive
fait expirer des tickets trop tôt. Et « Uptime » devient « Actif depuis », comme sur la Vue
d'ensemble : le même chiffre y portait deux noms.

**Vérifié écran par écran** : plus aucune valeur d'énumération anglaise sur Abonnements, la
fiche client, Connectés ni la Vue d'ensemble.

### 2026-09-20 — TIC-9 : le QR code du ticket

**Ce qu'il encode compte plus que sa présence.** Un QR portant les dix caractères du code
obligerait encore à les coller dans le portail. Avec un domaine de portail déclaré —
`wifitati.net` ici, que le routeur résout déjà vers lui-même — il porte
`http://<domaine>/login?username=CODE&password=CODE` : le client rejoint le Wi-Fi, scanne, et
la session s'ouvre sans qu'il ait rien saisi. Sans domaine, retour au code seul, ce qui reste
mieux que de recopier à la main.

**SVG et non image matricielle.** Une cellule de ticket fait 16 mm : une image de quelques
dizaines de pixels y sortirait floue, et un QR flou ne se lit pas.

**Une dépendance ajoutée, choisie sans dépendances.** `qrcode-generator` n'entraîne rien.
C'était la condition : `@nestjs/schedule` avait cassé l'application en étant hissé à la racine
avec `@nestjs/common` et `core`. Vérifié après installation — NestJS est resté dans le
workspace, rien à la racine.

**Le gabarit livré rattrape les anciens exploitants.** Ajouter le placeholder ne suffisait
pas : les gabarits déjà en base n'auraient pas bougé, et la fonctionnalité serait restée
invisible faute de savoir qu'il fallait l'ajouter à la main. Un gabarit dont le HTML est
**identique au caractère près** à la version précédemment livrée est remplacé — il n'a jamais
été touché, remplacer ne perd rien. Dès qu'il a été modifié, fût-ce d'un espace, il est à
l'exploitant et rien ne le réécrit.

**Éprouvé** : gabarit du parc aligné automatiquement, 4 tickets rendus, 4 QR en SVG
`viewBox 0 0 39 39` — 37 modules, bien trop pour dix caractères : c'est l'URL. Le QR est
placé à côté du code et non à sa place, un téléphone qui ne scanne pas devant toujours
permettre la saisie. Rien sur le gabarit 30/page : 64 × 28 mm ne laissent pas la place d'un
QR lisible.

### 2026-09-20 — Le SUPER_ADMIN peut cibler un exploitant

**Reproche fondé de l'exploitant** : j'avais livré un bouton « Générer » qui échouait
toujours sur son compte, et je l'avais **expliqué au lieu de le corriger**. Une console qui
propose une action impossible et ne le dit qu'après le clic est en défaut, quelle qu'en soit
la cause.

Le mécanisme était déjà prévu — le message de `requireTenantId` dit lui-même « le
SUPER_ADMIN doit cibler un exploitant », et `runAsTenant` existe — mais rien ne le reliait à
HTTP. Un en-tête `X-Tenant-Id`, lu **uniquement pour un SUPER_ADMIN**, et un sélecteur dans
la barre du haut.

**Le point qui décide de la forme** : en ciblant, le contournement est abandonné
(`isSuperAdmin: false`), exactement comme `runAsTenant`. Le garder donnerait des lectures sur
tout le parc et des écritures sur un seul exploitant, puisque `PrismaService.scoped` ignore
le cloisonnement dès que le drapeau est levé. En ciblant, le SUPER_ADMIN agit *comme* cet
exploitant et ne voit que lui.

**Éprouvé de bout en bout** : exploitant ciblé, lot de 2 tickets généré sur `2Heure-500Ar`,
2 comptes User Manager créés avec leurs attributions (`waiting` / `not-yet-running`) — et le
profil User Manager `2Heure-500Ar` (2 h) **créé au passage**, l'offre y étant désormais
rattachée. 646 comptes HotSpot à chaque mesure.

### Défaut trouvé en nettoyant : annuler ne coupait rien

En retirant les tickets d'essai, constat sur le routeur : après `cancel`, les comptes
restaient `disabled=false`. `cancel` se contentait de changer le statut en base.

Les comptes sont créés **dès la génération** — c'est ce qui fait qu'un ticket imprimé
fonctionne sans être activé. Un ticket annulé continuait donc d'ouvrir l'accès,
indéfiniment et sans que rien ne le signale : un code mal imprimé qu'on croyait retiré
restait utilisable. Antérieur à ce chantier, trouvé en vérifiant plutôt qu'en supposant.

`cancel` coupe désormais l'accès comme `disable` : révocation User Manager, ou désactivation
HotSpot avec purge des cookies et fermeture des sessions — désactiver seul laisserait un
cookie rouvrir la session sans repasser par RADIUS. Deux tests figent les deux cibles.

*Au passage*, le faux Prisma des tests ne savait chercher un ticket que par son code, pas par
son identifiant : tout ce qui part d'un `id` y échouait silencieusement.

**RTR-21 ✅ — l'onglet Paiements du routeur.** `/user-manager/payment` répond, et il est vide :
ce parc encaisse par Mobile Money, hors du routeur. Les noms de champs viennent donc des
colonnes de WinBox et **non d'un relevé** — troisième table dans ce cas, après `/ppp/active`.
L'écran le dit en bandeau, et distingue explicitement cette table de l'écran Paiements de
l'application, qui est la source de vérité commerciale.

---

> ⚠️ **Règle d'or** : chaque item livré → vérification sur le routeur réel avec nettoyage,
> charge utile relevée figée dans un test si un mapper est touché,
> **et mise à jour de la colonne « Implémenté » DE CE DOCUMENT** — le seul suivi qui fait foi.
> Avant de démarrer un item : **vérifier le code, pas la colonne.**
