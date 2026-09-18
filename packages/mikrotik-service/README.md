# @wifitati/mikrotik-service

Couche d'abstraction MikroTik pour **WIFI-TATI Manager**.

## Principe

```
Frontend
   ↓
Backend API (contrôleurs, services métier)
   ↓  ne connaît que IMikrotikService + les DTOs
MikrotikService (RouterOSMikrotikService)
   ↓  seule classe qui connaît le vocabulaire RouterOS
RouterOSRestClient (HTTP bas niveau : timeout, retry, auth)
   ↓
RouterOS REST API (/rest/...)
   ↓
MikroTik hAP ac²
```

Aucune couche en dehors de ce module ne doit :
- importer `RouterOSRestClient` directement,
- importer un fichier de `src/mappers/*`,
- connaître un chemin `/rest/...` ou un champ kebab-case RouterOS.

Elle importe uniquement depuis `src/index.ts` (`IMikrotikService` + DTOs +
erreurs).

## Structure des fichiers

```
wifitati-mikrotik-service/
├── package.json
├── tsconfig.json
├── jest.config.js
├── README.md
├── src/
│   ├── index.ts                          # point d'entrée public du module
│   ├── routeros-mikrotik.service.ts      # implémentation REST de IMikrotikService
│   ├── interfaces/
│   │   └── mikrotik-service.interface.ts # contrat abstrait (20 méthodes demandées)
│   ├── dto/
│   │   ├── router.dto.ts                 # identity, system resource, interfaces, clock, ntp, radius
│   │   ├── hotspot.dto.ts                # active users, hosts, users, profiles
│   │   ├── user-manager.dto.ts           # users, profiles, limitations, user-profiles, sessions
│   │   └── commands.dto.ts               # DTOs d'entrée des opérations d'écriture
│   ├── validation/
│   │   ├── schemas.ts                    # schémas Zod par opération d'écriture
│   │   └── validate.ts                   # helper validate() -> MikrotikValidationError
│   ├── mappers/
│   │   ├── router.mapper.ts              # JSON brut RouterOS -> DTO (système)
│   │   ├── hotspot.mapper.ts             # JSON brut RouterOS -> DTO (HotSpot) + parseRouterOsDuration()
│   │   └── user-manager.mapper.ts        # JSON brut RouterOS -> DTO (User Manager)
│   ├── client/
│   │   ├── routeros-rest-client.ts       # client HTTP bas niveau (timeout, retry, auth, logs)
│   │   └── retry.ts                      # backoff exponentiel contrôlé
│   ├── errors/
│   │   └── mikrotik.errors.ts            # hiérarchie MikrotikError (la seule famille d'erreurs exposée)
│   ├── logging/
│   │   ├── logger.interface.ts           # ILogger (abstraction, pas de dépendance à un framework)
│   │   └── console-logger.ts             # implémentation par défaut avec redaction des secrets
│   └── config/
│       └── mikrotik-client.config.ts     # RouterOSClientConfig (jamais de secrets en dur)
└── tests/
    ├── mocks/
    │   ├── mock-routeros-rest-client.ts  # mock jest du client HTTP (get/post/patch/delete)
    │   ├── mock-mikrotik.service.ts      # fausse implémentation en mémoire de IMikrotikService
    │   └── silent-logger.ts              # logger muet pour les tests
    ├── routeros-mikrotik.service.spec.ts # tests de la logique métier (mapping, validation, conflits)
    └── client/
        └── routeros-rest-client.spec.ts  # tests timeout / retry / mapping d'erreurs HTTP
```

## Utilisation côté backend

```ts
import {
  RouterOSRestClient,
  RouterOSMikrotikService,
  ConsoleLogger,
  IMikrotikService,
} from '@wifitati/mikrotik-service';

const logger = new ConsoleLogger('mikrotik');

const client = new RouterOSRestClient(
  {
    baseUrl: process.env.MIKROTIK_BASE_URL!,     // ex: https://192.168.88.1
    username: process.env.MIKROTIK_SVC_USERNAME!,
    password: process.env.MIKROTIK_SVC_PASSWORD!, // depuis un coffre-fort de secrets
    timeoutMs: 5000,
    maxRetries: 2,
  },
  logger,
);

// Le reste de l'application ne dépend QUE de ce type :
const mikrotikService: IMikrotikService = new RouterOSMikrotikService(client, logger);

const health = await mikrotikService.getSystemResource();
const activeUsers = await mikrotikService.getHotspotActiveUsers();
```

Dans les tests du reste du backend (contrôleurs, services métier), on
injecte `MockMikrotikService` à la place de `RouterOSMikrotikService` — le
code testé ne voit aucune différence puisqu'il ne dépend que de
`IMikrotikService`.

## Sécurité

- Le mot de passe et tout secret ne sont **jamais** loggués (voir
  `ConsoleLogger` : redaction automatique, et `RouterOSRestClient` qui ne
  logue jamais le `body` des requêtes).
- Toute entrée d'écriture passe par un schéma Zod avant le moindre appel
  réseau (`validate()`), indépendamment de la validation déjà faite côté
  contrôleur HTTP du backend (défense en profondeur).
- Le compte RouterOS utilisé par ce module doit être un compte de service
  dédié à permissions minimales (`api`, `rest-api`, `read`, `write`
  uniquement) — voir le document de conception technique WIFI-TATI Manager,
  section 8.

## Tests

```bash
npm install
npm test
npm run test:coverage
```

Deux niveaux de tests sont fournis :
1. `tests/client/routeros-rest-client.spec.ts` — la robustesse réseau pure
   (timeout, retry contrôlé, mapping des codes HTTP en `MikrotikError`).
2. `tests/routeros-mikrotik.service.spec.ts` — la logique métier
   (mapping DTO, validation, détection de conflit/not-found), avec le
   client REST mocké.
