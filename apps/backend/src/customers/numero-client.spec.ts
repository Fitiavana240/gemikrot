import { describe, expect, it, vi } from 'vitest';
import { CustomersService } from './customers.service.js';

/**
 * Le numéro tel qu'il se range en base.
 *
 * Trois écritures du même numéro faisaient trois fiches, là où la contrainte
 * d'unicité `(tenantId, phone)` ne voyait aucun doublon. Le jour où l'on
 * cherche « qui a ce numéro », on n'en trouve qu'un tiers — et le lien
 * WhatsApp de l'écran Abonnements ouvre la discussion de personne.
 */

function service() {
  const create = vi.fn(async ({ data }: any) => data);
  const update = vi.fn(async ({ data }: any) => data);
  const prisma: any = {
    scoped: { customer: { create, update, findUnique: vi.fn(async () => ({ id: 'c1' })) } },
  };
  return {
    service: new CustomersService(prisma, { requireTenantId: () => 't1' } as never),
    create,
    update,
  };
}

describe('numéro rangé à la création', () => {
  it('ramène les trois écritures à la même', async () => {
    for (const écrit of ['034 03 941 88', '+261 34 03 941 88', '0340394188', '00261340394188']) {
      const { service: s, create } = service();

      await s.create({ name: 'Naivo', phone: écrit } as never);

      expect((create.mock.calls[0] as any)[0].data.phone).toBe('340394188');
    }
  });

  it('ne touche pas à l’identifiant provisoire de l’import', async () => {
    // Ce n'est pas un numéro. Le normaliser le réduirait à rien, et tout ce
    // qui le reconnaît par son préfixe cesserait de fonctionner — à commencer
    // par le compte des clients injoignables du tableau de bord.
    const { service: s, create } = service();

    await s.create({ name: 'Importé', phone: 'import:user42' } as never);

    expect((create.mock.calls[0] as any)[0].data.phone).toBe('import:user42');
  });

  it('garde tel quel ce qui n’est pas un numéro malgache plausible', async () => {
    // Mieux vaut un numéro étranger lisible qu'une bouillie de chiffres que
    // personne ne peut recomposer.
    const { service: s, create } = service();

    await s.create({ name: 'Étranger', phone: '+33 6 12 34 56 78 90 12' } as never);

    expect((create.mock.calls[0] as any)[0].data.phone).toBe('+33 6 12 34 56 78 90 12');
  });
});

describe('numéro rangé à la correction', () => {
  it('range le numéro corrigé', async () => {
    const { service: s, update } = service();

    await s.update('c1', { phone: '034 03 941 88' } as never);

    expect((update.mock.calls[0] as any)[0].data.phone).toBe('340394188');
  });

  it('ne pose pas de téléphone quand la correction n’en parle pas', async () => {
    // Un `undefined` transformé en chaîne écraserait le numéro existant par
    // du vide, sur une requête qui ne voulait changer que le nom.
    const { service: s, update } = service();

    await s.update('c1', { name: 'Nouveau nom' } as never);

    expect((update.mock.calls[0] as any)[0].data).not.toHaveProperty('phone');
  });
});
