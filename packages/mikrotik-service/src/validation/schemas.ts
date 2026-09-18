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
  validityDurationSeconds: z.number().int().positive(),
  startsWhen: z.enum(['logon', 'creation']),
  rateLimitRxBitsPerSecond: z.number().int().positive().optional(),
  rateLimitTxBitsPerSecond: z.number().int().positive().optional(),
  transferLimitBytes: z.number().int().positive().optional(),
  sharedUsers: z.number().int().positive().max(50).optional(),
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
