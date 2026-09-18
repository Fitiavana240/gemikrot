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
