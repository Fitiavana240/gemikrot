import { describe, expect, it } from 'vitest';
import { of } from 'rxjs';
import { TenantContextInterceptor } from './tenant-context.interceptor.js';
import { TenantContextService } from './tenant-context.service.js';

/**
 * L'en-tête qui accorde un privilège mérite son filet.
 *
 * `x-tenant-id` fait agir un SUPER_ADMIN **comme** un exploitant donné.
 * C'est le seul endroit de l'application où une en-tête HTTP change le
 * cloisonnement : si la condition de rôle disparaissait un jour, n'importe
 * quel compte se donnerait accès à n'importe quel exploitant en ajoutant une
 * ligne à sa requête. Rien ne l'éprouvait.
 */
function contexteVu(
  role: string | undefined,
  tenantIdDuJeton: string | null,
  entête?: string | string[],
) {
  const service = new TenantContextService();
  const interceptor = new TenantContextInterceptor(service);
  const requête = {
    user: role ? { id: 'u1', role, tenantId: tenantIdDuJeton } : undefined,
    headers: entête === undefined ? {} : { 'x-tenant-id': entête },
  };
  const context = { switchToHttp: () => ({ getRequest: () => requête }) } as never;

  let vu: ReturnType<TenantContextService['get']>;
  const next = { handle: () => { vu = service.get(); return of(null); } };
  interceptor.intercept(context, next as never).subscribe();
  return vu!;
}

describe('TenantContextInterceptor', () => {
  it('ignore l’en-tête pour un compte qui n’est pas SUPER_ADMIN', () => {
    // La propriété de sécurité du fichier : un ADMIN qui forge l'en-tête ne
    // doit pas quitter son exploitant d'un pouce.
    const vu = contexteVu('ADMIN', 'tenant-a', 'tenant-b');

    expect(vu).toEqual({ tenantId: 'tenant-a', isSuperAdmin: false });
  });

  it('place le SUPER_ADMIN sur l’exploitant ciblé', () => {
    const vu = contexteVu('SUPER_ADMIN', null, 'tenant-b');

    expect(vu.tenantId).toBe('tenant-b');
  });

  it('abandonne le contournement dès qu’un exploitant est ciblé', () => {
    // Garder `isSuperAdmin` donnerait des lectures sur tout le parc et des
    // écritures sur un seul : un mélange dont aucun écran ne se remettrait.
    const vu = contexteVu('SUPER_ADMIN', null, 'tenant-b');

    expect(vu.isSuperAdmin).toBe(false);
  });

  it('garde le contournement quand aucun exploitant n’est ciblé', () => {
    const vu = contexteVu('SUPER_ADMIN', null);

    expect(vu).toEqual({ tenantId: null, isSuperAdmin: true });
  });

  it('traite un en-tête vide ou blanc comme absent', () => {
    expect(contexteVu('SUPER_ADMIN', null, '')).toEqual({ tenantId: null, isSuperAdmin: true });
    expect(contexteVu('SUPER_ADMIN', null, '   ')).toEqual({
      tenantId: null,
      isSuperAdmin: true,
    });
  });

  it('rejette un en-tête répété plutôt que d’en choisir un', () => {
    // Node rend un tableau quand l'en-tête est envoyé deux fois. En retenir
    // une valeur au hasard rendrait le cloisonnement dépendant de l'ordre.
    const vu = contexteVu('SUPER_ADMIN', null, ['tenant-a', 'tenant-b']);

    expect(vu).toEqual({ tenantId: null, isSuperAdmin: true });
  });

  it('ne donne aucun exploitant à une requête sans utilisateur', () => {
    const vu = contexteVu(undefined, null, 'tenant-b');

    expect(vu).toEqual({ tenantId: null, isSuperAdmin: false });
  });
});
