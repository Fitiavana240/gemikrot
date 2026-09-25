import { z } from 'zod';

/**
 * Toute donnée entrante destinée à RouterOS transite par un de ces schémas
 * AVANT le moindre appel réseau. Objectif : ne jamais laisser une valeur
 * malformée atteindre l'API RouterOS (défense en profondeur, en plus de la
 * validation déjà faite côté backend/contrôleur HTTP).
 */

export const createUserManagerUserSchema = z.object({
  username: z
    .string()
    .min(3, 'Le nom d\'utilisateur doit contenir au moins 3 caractères')
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Caractères non autorisés dans le nom d\'utilisateur'),
  password: z.string().min(4).max(128),
  sharedUsers: z.number().int().positive().max(50).optional(),
  comment: z.string().max(255).optional(),
  group: z.string().max(64).optional(),
});

export const updateUserManagerUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Caractères non autorisés dans le nom d\'utilisateur'),
  password: z.string().min(4).max(128).optional(),
  sharedUsers: z.number().int().positive().max(50).optional(),
  comment: z.string().max(255).optional(),
  group: z.string().max(64).optional(),
});

/**
 * Le nom d'une limitation traverse l'URL lors des mises à jour et des
 * suppressions : le jeu de caractères est volontairement restreint, à
 * l'identique des noms de profils.
 */
export const createLimitationSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_.-]+$/, 'Caractères non autorisés dans le nom de la limitation'),
  // `null` = aucune limite ; RouterOS l'enregistre comme zéro.
  rateLimitRxBitsPerSecond: z.number().int().positive().nullable().optional(),
  rateLimitTxBitsPerSecond: z.number().int().positive().nullable().optional(),
  transferLimitBytes: z.number().int().positive().nullable().optional(),
  downloadLimitBytes: z.number().int().positive().nullable().optional(),
  uploadLimitBytes: z.number().int().positive().nullable().optional(),
  uptimeLimitSeconds: z.number().int().positive().nullable().optional(),
  resetCountersIntervalSeconds: z.number().int().positive().nullable().optional(),
  // La forme exacte que RouterOS écrit. Refuser ici plutôt que de laisser le
  // routeur rendre une erreur qu'on ne saurait pas traduire.
  resetCountersStartTime: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, 'Date attendue au format AAAA-MM-JJ HH:MM:SS')
    .nullable()
    .optional(),
  rateLimitMinRxBitsPerSecond: z.number().int().positive().nullable().optional(),
  rateLimitMinTxBitsPerSecond: z.number().int().positive().nullable().optional(),
  // La priorité admet **zéro**, qui est la plus forte : `positive()` la
  // refuserait, et c'est la valeur que portent les deux limitations du parc.
  rateLimitPriority: z.number().int().min(0).max(8).nullable().optional(),
  rateLimitBurstRxBitsPerSecond: z.number().int().positive().nullable().optional(),
  rateLimitBurstTxBitsPerSecond: z.number().int().positive().nullable().optional(),
  rateLimitBurstThresholdRxBitsPerSecond: z.number().int().positive().nullable().optional(),
  rateLimitBurstThresholdTxBitsPerSecond: z.number().int().positive().nullable().optional(),
  rateLimitBurstTimeRxSeconds: z.number().int().positive().nullable().optional(),
  rateLimitBurstTimeTxSeconds: z.number().int().positive().nullable().optional(),
});

export const updateLimitationSchema = createLimitationSchema.partial().extend({
  name: createLimitationSchema.shape.name,
});

export const attachLimitationSchema = z.object({
  profileName: z.string().min(2).max(64),
  limitationName: z.string().min(2).max(64),
});

export const limitationNameParamSchema = createLimitationSchema.shape.name;

export const profileNameParamSchema = z.string().min(2).max(64);

export const createProfileSchema = z.object({
  name: z.string().min(2).max(64),
  // `null` = validité illimitée, valeur légitime côté RouterOS.
  validityDurationSeconds: z.number().int().positive().nullable(),
  startsWhen: z.enum(['first-auth', 'assigned']),
  price: z.number().nonnegative().optional(),
  nameForUsers: z.string().max(64).optional(),
  sharedUsers: z.number().int().positive().max(50).optional(),
  comment: z.string().max(255).optional(),
});

export const updateProfileSchema = createProfileSchema.partial().extend({
  name: z.string().min(2).max(64),
});

export const assignProfileSchema = z.object({
  username: z.string().min(3).max(64),
  profileName: z.string().min(2).max(64),
});

export const removeProfileAssignmentSchema = assignProfileSchema;

export const disconnectHotspotUserSchema = z.object({
  sessionId: z.string().min(1),
});

export const usernameParamSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-zA-Z0-9_.-]+$/);

// ---------- HotSpot local ----------

export const hotspotUsernameParamSchema = z
  .string()
  .min(1)
  .max(64)
  // Les comptes existants contiennent des tirets et des chiffres
  // ("BELLO25-07", "H866646") : le jeu de caractères reste volontairement
  // large, mais exclut espaces et séparateurs interprétés par RouterOS.
  .regex(/^[a-zA-Z0-9_.@-]+$/, 'Caractères non autorisés dans le nom du compte HotSpot');

const macAddressSchema = z
  .string()
  .regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/, 'Adresse MAC invalide (format AA:BB:CC:DD:EE:FF)');

/**
 * Un an. Au-delà, c'est presque sûrement une saisie en secondes prise pour
 * des heures : le refuser vaut mieux que de créer un ticket éternel.
 */
const UPTIME_MAX_SECONDES = 366 * 24 * 3600;

export const createHotspotUserSchema = z.object({
  username: hotspotUsernameParamSchema,
  password: z.string().min(1).max(128),
  profileName: z.string().min(1).max(64),
  server: z.string().max(64).optional(),
  comment: z.string().max(255).optional(),
  /**
   * Plafond de temps cumulé du compte — `limit-uptime` côté RouterOS.
   *
   * C'est ainsi que le parc vend ses tickets courts : 400 de ses 646 comptes
   * en portent un, `2h` pour un ticket à 500 Ar. À ne pas confondre avec la
   * validité d'un profil User Manager, qui est calendaire ; celui-ci ne
   * s'écoule que pendant les sessions.
   */
  limitUptimeSeconds: z.number().int().positive().max(UPTIME_MAX_SECONDES).nullish(),
  /**
   * Quotas du compte, indépendants du profil.
   *
   * `nullish` et non `optional` : `null` retire le plafond, absent n'y touche
   * pas. Sans cette distinction, un formulaire qui ne renvoie pas le champ
   * effacerait un quota qu'on ne voulait pas changer.
   */
  limitBytesIn: z.number().int().positive().nullish(),
  limitBytesOut: z.number().int().positive().nullish(),
  limitBytesTotal: z.number().int().positive().nullish(),
  /**
   * Lier ce compte a un appareil, pour qu'il se connecte seul.
   *
   * Avec `login-by=mac` sur le profil du serveur, RouterOS ouvre la session
   * de lui-meme des que cette MAC apparait : le client ne voit aucune page.
   * C'est le meme confort qu'un contournement, mais **c'est une session** --
   * donc le profil s'applique, et l'echeance aussi. Un contournement, lui,
   * n'ouvre rien et ne s'arrete jamais.
   */
  macAddress: macAddressSchema.nullish(),
});

export const updateHotspotUserSchema = z.object({
  username: hotspotUsernameParamSchema,
  profileName: z.string().min(1).max(64).optional(),
  /** `null` delie l'appareil ; `undefined` n'y touche pas. */
  macAddress: macAddressSchema.nullish(),
  password: z.string().min(1).max(128).optional(),
  comment: z.string().max(255).optional(),
  server: z.string().max(64).optional(),
  /** `null` retire le plafond ; `undefined` ne touche à rien. */
  limitUptimeSeconds: z.number().int().positive().max(UPTIME_MAX_SECONDES).nullish(),
  /**
   * Quotas du compte, indépendants du profil.
   *
   * `nullish` et non `optional` : `null` retire le plafond, absent n'y touche
   * pas. Sans cette distinction, un formulaire qui ne renvoie pas le champ
   * effacerait un quota qu'on ne voulait pas changer.
   */
  limitBytesIn: z.number().int().positive().nullish(),
  limitBytesOut: z.number().int().positive().nullish(),
  limitBytesTotal: z.number().int().positive().nullish(),
});

export const createHotspotProfileSchema = z.object({
  name: z.string().min(1).max(64),
  rateLimitRxBitsPerSecond: z.number().int().positive().optional(),
  rateLimitTxBitsPerSecond: z.number().int().positive().optional(),
  sessionTimeoutSeconds: z.number().int().positive().optional(),
  sharedUsers: z.number().int().positive().max(100).optional(),
  // `nullable` et non `optional` seulement : `null` retire la limite, absent
  // n'y touche pas. Les confondre effacerait un réglage non demandé.
  idleTimeoutSeconds: z.number().int().nonnegative().nullable().optional(),
  keepaliveTimeoutSeconds: z.number().int().nonnegative().nullable().optional(),
  addMacCookie: z.boolean().optional(),
  macCookieTimeoutSeconds: z.number().int().nonnegative().nullable().optional(),
});

export const updateHotspotProfileSchema = createHotspotProfileSchema.partial().extend({
  name: z.string().min(1).max(64),
});

export const createIpBindingSchema = z.object({
  macAddress: macAddressSchema,
  type: z.enum(['regular', 'bypassed', 'blocked']),
  server: z.string().max(64).optional(),
  address: z.string().max(64).optional(),
  comment: z.string().max(255).optional(),
});

export const ipBindingTypeSchema = z.enum(['regular', 'bypassed', 'blocked']);

// ---------- Walled Garden ----------

/**
 * Un port, ou une plage `3000-3010`. RouterOS **refuse** ici une liste
 * séparée par des virgules — relevé sur le hAP : « invalid value 3000,5173
 * for min, an integer required ». Ouvrir deux ports distincts demande donc
 * deux entrées.
 */
const portSchema = z
  .string()
  .regex(/^\d{1,5}(-\d{1,5})?$/, 'Un port ou une plage (3000 ou 3000-3010)');

export const createWalledGardenEntrySchema = z.object({
  // Un nom de domaine, éventuellement avec joker : `*.mvola.mg`.
  dstHost: z
    .string()
    .min(3)
    .max(253)
    .regex(/^[a-zA-Z0-9*._-]+$/, 'Nom de domaine invalide'),
  action: z.enum(['allow', 'deny']).optional(),
  dstPort: portSchema.optional(),
  comment: z.string().max(255).optional(),
});

export const createWalledGardenIpEntrySchema = z.object({
  // Adresse ou réseau : `192.0.2.7` ou `192.0.2.0/24`.
  dstAddress: z
    .string()
    .min(7)
    .max(43)
    .regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, 'Adresse invalide'),
  action: z.enum(['accept', 'drop', 'reject']).optional(),
  dstPort: portSchema.optional(),
  protocol: z.enum(['tcp', 'udp', 'icmp']).optional(),
  comment: z.string().max(255).optional(),
});

export const routerosIdSchema = z.string().min(1).max(64).regex(/^\*?[0-9A-Fa-f]+$/);

/**
 * Un nom de compte PPPoE finit dans une commande RouterOS : il est restreint
 * aux mêmes caractères que les autres identifiants, avant tout appel réseau.
 */
export const createPppSecretSchema = z.object({
  username: z
    .string()
    .min(3, 'Le nom du compte doit contenir au moins 3 caractères')
    .max(64)
    .regex(/^[a-zA-Z0-9_.@-]+$/, 'Caractères non autorisés dans le nom du compte'),
  password: z.string().min(4).max(128),
  profile: z.string().max(64).optional(),
  service: z.enum(['pppoe', 'any', 'pptp', 'l2tp', 'ovpn', 'sstp']).optional(),
  remoteAddress: z.string().max(45).optional(),
  comment: z.string().max(255).optional(),
});

/**
 * Modification d'un compte PPPoE.
 *
 * Le nom n'y figure pas : il identifie le compte, le changer reviendrait à
 * en créer un autre en perdant son historique. Tout le reste est facultatif,
 * et **seuls les champs fournis sont écrits** — un formulaire qui renvoie
 * tout écraserait un réglage posé ailleurs.
 */
export const updatePppSecretSchema = z
  .object({
    password: z.string().min(4).max(128).optional(),
    profile: z.string().max(64).optional(),
    service: z.enum(['pppoe', 'any', 'pptp', 'l2tp', 'ovpn', 'sstp']).optional(),
    remoteAddress: z.string().max(45).optional(),
    comment: z.string().max(255).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Aucune modification demandée',
  });

// ---------- Files d'attente simples ----------

/**
 * Un débit, en bits par seconde.
 *
 * Le nombre plutôt que la forme RouterOS `2M/5M` : la lecture rend déjà des
 * nombres, et deux unités qui ne se ressemblent pas d'un bout à l'autre du
 * produit finissent par se croiser. La conversion en mégabits appartient à
 * l'écran, qui est le seul endroit où l'exploitant pense en mégabits.
 *
 * Plafonné à 10 Gbit/s : au-delà, c'est une faute de frappe — un zéro de trop
 * transforme une limite en absence de limite, sans que rien ne le signale.
 */
const debitSchema = z.number().int().positive().max(10_000_000_000);

export const createSimpleQueueSchema = z.object({
  name: z.string().min(1).max(64),
  /** Adresse, plage ou interface à laquelle la file s'applique. */
  target: z.string().min(1).max(128),
  /** Ce que le client envoie. */
  maxLimitUpload: debitSchema,
  /** Ce que le client reçoit — le chiffre qu'il perçoit comme « le débit ». */
  maxLimitDownload: debitSchema,
  comment: z.string().max(255).optional(),
  disabled: z.boolean().optional(),
});

export const updateSimpleQueueSchema = createSimpleQueueSchema
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Aucune modification demandée',
  })
  .refine(
    (v) =>
      (v.maxLimitUpload === undefined) === (v.maxLimitDownload === undefined),
    {
      // `max-limit` est un seul champ à deux membres : RouterOS le remplace
      // en entier. N'en envoyer qu'un effacerait l'autre — et une limite
      // descendante effacée passe inaperçue jusqu'à la facture.
      message: 'Les deux sens du plafond se règlent ensemble',
    },
  );
