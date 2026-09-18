import { ZodSchema } from 'zod';
import { MikrotikValidationError } from '../errors/mikrotik.errors';

/**
 * Valide `input` contre `schema` et retourne les données typées et nettoyées.
 * Toute violation est traduite en `MikrotikValidationError`, jamais en
 * exception Zod brute, afin que l'appelant n'ait qu'une seule famille
 * d'erreurs à connaître : `MikrotikError`.
 */
export function validate<T>(schema: ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new MikrotikValidationError('Données invalides pour l\'opération RouterOS', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
