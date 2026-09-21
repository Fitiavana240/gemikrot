import { describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service.js';

/**
 * Changer son mot de passe.
 *
 * Aucune route ne le permettait, ni ici ni dans l'interface : un mot de passe
 * éventé ne laissait qu'une porte de sortie, créer un second compte
 * d'administration et supprimer l'ancien. Ces tests fixent les quatre refus
 * qui comptent, pour qu'ils ne s'assouplissent pas par inadvertance.
 */
async function service(motDePasseActuel = 'MotDePasseActuel1!') {
  const admin = {
    id: 'admin-1',
    email: 'exploitant@example.test',
    tenantId: 'tenant-1',
    passwordHash: await bcrypt.hash(motDePasseActuel, 10),
  };
  const update = vi.fn(async (_args: { data: { passwordHash: string } }) => admin);
  const log = vi.fn(async () => undefined);
  const prisma = {
    adminUser: { findUnique: vi.fn(async () => admin), update },
  };
  // Le limiteur de connexion ne concerne pas ce chemin, mais la classe
  // l'exige désormais : un objet inerte suffit.
  const throttle = { verifier: vi.fn(), echec: vi.fn(), succes: vi.fn() };
  return {
    admin,
    update,
    log,
    svc: new AuthService(prisma as never, {} as never, { log } as never, throttle as never),
  };
}

describe('AuthService.changePassword', () => {
  it('remplace l’empreinte quand l’ancien mot de passe est bon', async () => {
    const { svc, update } = await service();

    await expect(
      svc.changePassword('admin-1', {
        currentPassword: 'MotDePasseActuel1!',
        newPassword: 'MotDePasseNouveau2!',
      }),
    ).resolves.toEqual({ ok: true });

    const écrit = update.mock.calls[0]![0].data.passwordHash;
    // Une empreinte, jamais le mot de passe en clair.
    expect(écrit).not.toBe('MotDePasseNouveau2!');
    await expect(bcrypt.compare('MotDePasseNouveau2!', écrit)).resolves.toBe(true);
  });

  it('refuse un mot de passe actuel faux, et n’écrit rien', async () => {
    // Le point du test est le `update` : refuser en écrivant quand même
    // serait pire que ne pas refuser du tout.
    const { svc, update } = await service();

    await expect(
      svc.changePassword('admin-1', { currentPassword: 'faux', newPassword: 'Nouveau123456!' }),
    ).rejects.toThrow(/actuel incorrect/);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuse un nouveau mot de passe trop court', async () => {
    const { svc, update } = await service();

    await expect(
      svc.changePassword('admin-1', {
        currentPassword: 'MotDePasseActuel1!',
        newPassword: 'abc',
      }),
    ).rejects.toThrow(/6 caractères/);
    expect(update).not.toHaveBeenCalled();
  });

  it('refuse de « changer » pour le même mot de passe', async () => {
    const { svc, update } = await service();

    await expect(
      svc.changePassword('admin-1', {
        currentPassword: 'MotDePasseActuel1!',
        newPassword: 'MotDePasseActuel1!',
      }),
    ).rejects.toThrow(/différent/);
    expect(update).not.toHaveBeenCalled();
  });

  it('ne journalise jamais le mot de passe, seulement le fait', async () => {
    const { svc, log } = await service();

    await svc.changePassword('admin-1', {
      currentPassword: 'MotDePasseActuel1!',
      newPassword: 'MotDePasseNouveau2!',
    });

    const entrée = JSON.stringify(log.mock.calls.at(-1));
    expect(entrée).not.toContain('MotDePasseNouveau2!');
    expect(entrée).not.toContain('MotDePasseActuel1!');
    expect(entrée).toContain('passwordHash');
  });
});
