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
  uptimeLimitSeconds: z.number().int().positive().nullable().optional(),
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

export const createHotspotUserSchema = z.object({
  username: hotspotUsernameParamSchema,
  password: z.string().min(1).max(128),
  profileName: z.string().min(1).max(64),
  server: z.string().max(64).optional(),
  comment: z.string().max(255).optional(),
});

export const updateHotspotUserSchema = z.object({
  username: hotspotUsernameParamSchema,
  profileName: z.string().min(1).max(64).optional(),
  password: z.string().min(1).max(128).optional(),
  comment: z.string().max(255).optional(),
});

export const createHotspotProfileSchema = z.object({
  name: z.string().min(1).max(64),
  rateLimitRxBitsPerSecond: z.number().int().positive().optional(),
  rateLimitTxBitsPerSecond: z.number().int().positive().optional(),
  sessionTimeoutSeconds: z.number().int().positive().optional(),
  sharedUsers: z.number().int().positive().max(100).optional(),
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
