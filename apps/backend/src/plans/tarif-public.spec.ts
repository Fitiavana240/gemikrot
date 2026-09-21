import { describe, expect, it, vi } from 'vitest';
import { PlansService } from './plans.service.js';
import { RapprochementProfilsService } from './rapprochement-profils.service.js';

/**
 * Les deux gestes qui décident de ce que le client voit.
 *
 * « Afficher au tarif d'abonnement » fait entrer un profil du routeur dans la
 * page de paiement ; « Supprimer » retire une offre de la base pour de bon.
 * Les deux touchent à l'argent, et dans deux sens opposés : l'un met en
 * vente, l'autre efface. Ce qu'ils ne font **pas** compte autant que ce
 * qu'ils font, et c'est ce que ces épreuves fixent.
 */

const PROFIL_2H = {
  id: '*1',
  name: '2Heure-500Ar',
  nameForUsers: null,
  comment: null,
  validityDurationSeconds: 7200,
  startsWhen: 'first-auth' as const,
  price: 500,
  overrideSharedUsers: 1,
};

function faussesDépendances(
  profils: unknown[],
  offreExistante: Record<string, unknown> | null = null,
) {
  const mikrotik = {
    getUserManagerProfiles: vi.fn(async () => profils as any[]),
    // Aucune écriture ne doit partir : le profil existe déjà et sert déjà des
    // clients. Les déclarer permet de le constater plutôt que de planter sur
    // une méthode absente, ce qui se confondrait avec une autre erreur.
    createProfile: vi.fn(async () => ({})),
    updateProfile: vi.fn(async () => ({})),
    deleteProfile: vi.fn(async () => undefined),
    createHotspotProfile: vi.fn(async () => ({})),
  };

  const plan = {
    findFirst: vi.fn(async () => offreExistante),
    create: vi.fn(async ({ data }: any) => ({ id: 'plan-neuf', ...data })),
    update: vi.fn(async ({ data }: any) => ({ ...offreExistante, ...data })),
  };

  const prisma: any = { scoped: { plan } };
  const audit = { log: vi.fn(async () => undefined) };

  const service = new RapprochementProfilsService(
    prisma,
    { requireTenantId: () => 'tenant-1' } as any,
    {
      forDefaultRouter: async () => mikrotik,
      forRouter: async () => mikrotik,
    } as any,
    audit as any,
  );

  return { service, mikrotik, plan, audit };
}

describe('publierAuTarif', () => {
  it('crée une offre active à partir du profil, à son prix', async () => {
    const { service, plan } = faussesDépendances([PROFIL_2H]);

    const r = await service.publierAuTarif('2Heure-500Ar', 'admin-1');

    expect(r.cree).toBe(true);
    const { data } = plan.create.mock.calls[0][0] as any;
    expect(data).toMatchObject({
      name: '2Heure-500Ar',
      price: 500,
      validityDurationSeconds: 7200,
      status: 'ACTIVE',
      kind: 'TICKET',
      // Le rattachement explicite : sans lui, l'offre resterait un simple
      // homonyme du profil, l'état que cet écran sert justement à lever.
      umProfileName: '2Heure-500Ar',
    });
  });

  it('n’écrit rien sur le routeur', async () => {
    // C'est la promesse du bouton. Le profil sert déjà des clients ; le
    // toucher pour le mettre en vitrine reviendrait à modifier ce qui les
    // sert pour une raison commerciale.
    const { service, mikrotik } = faussesDépendances([PROFIL_2H]);

    await service.publierAuTarif('2Heure-500Ar', 'admin-1');

    expect(mikrotik.createProfile).not.toHaveBeenCalled();
    expect(mikrotik.updateProfile).not.toHaveBeenCalled();
    expect(mikrotik.deleteProfile).not.toHaveBeenCalled();
    expect(mikrotik.createHotspotProfile).not.toHaveBeenCalled();
  });

  it('refuse un profil sans prix', async () => {
    // Il s'afficherait à 0 Ar sur la page de paiement et se vendrait pour
    // rien — à n'importe qui connecté au Wi-Fi, sans qu'aucun écran ne le
    // rattrape ensuite.
    const { service, plan } = faussesDépendances([{ ...PROFIL_2H, price: 0 }]);

    await expect(service.publierAuTarif('2Heure-500Ar', 'admin-1')).rejects.toThrow(/prix/i);
    expect(plan.create).not.toHaveBeenCalled();
  });

  it('refuse un profil sans validité', async () => {
    // RouterOS ne saurait pas quand couper : l'accès se vendrait sans fin.
    const { service } = faussesDépendances([{ ...PROFIL_2H, validityDurationSeconds: null }]);

    await expect(service.publierAuTarif('2Heure-500Ar', 'admin-1')).rejects.toThrow(
      /validité/i,
    );
  });

  it('réactive une offre archivée sans toucher à son prix', async () => {
    // Le prix de l'offre a servi aux ventes passées. L'aligner en silence sur
    // celui de WinBox baisserait un tarif que l'exploitant avait relevé.
    const { service, plan } = faussesDépendances([{ ...PROFIL_2H, price: 400 }], {
      id: 'plan-1',
      name: '2Heure-500Ar',
      kind: 'TICKET',
      status: 'ARCHIVED',
      price: 500,
      priceNeedsReview: false,
    });

    const r = await service.publierAuTarif('2Heure-500Ar', 'admin-1');

    expect(r.cree).toBe(false);
    const { data } = plan.update.mock.calls[0][0] as any;
    expect(data.status).toBe('ACTIVE');
    expect(data).not.toHaveProperty('price');
  });

  it('refuse une offre dont le prix n’est pas confirmé', async () => {
    // `priceNeedsReview` dit « ce prix a été deviné à l'import ». Le vendre
    // en l'état afficherait au client un tarif que personne n'a validé.
    const { service, plan } = faussesDépendances([PROFIL_2H], {
      id: 'plan-1',
      name: '2Heure-500Ar',
      kind: 'TICKET',
      status: 'ARCHIVED',
      price: 500,
      priceNeedsReview: true,
    });

    await expect(service.publierAuTarif('2Heure-500Ar', 'admin-1')).rejects.toThrow(
      /confirmé/i,
    );
    expect(plan.update).not.toHaveBeenCalled();
  });

  it('refuse un abonnement', async () => {
    // Un abonnement se renouvelle au comptoir. Basculer son genre pour le
    // faire entrer dans la page publique changerait ce qu'il est.
    const { service, plan } = faussesDépendances([PROFIL_2H], {
      id: 'plan-1',
      name: '2Heure-500Ar',
      kind: 'SUBSCRIPTION',
      status: 'ACTIVE',
      price: 500,
      priceNeedsReview: false,
    });

    await expect(service.publierAuTarif('2Heure-500Ar', 'admin-1')).rejects.toThrow(
      /abonnement/i,
    );
    expect(plan.update).not.toHaveBeenCalled();
  });
});

describe('retirerDuTarif', () => {
  it('archive l’offre, ne la supprime pas', async () => {
    // Les tickets déjà vendus sur ce profil continuent de fonctionner, et les
    // recettes gardent à quoi se rattacher.
    const { service, plan } = faussesDépendances([PROFIL_2H], {
      id: 'plan-1',
      name: '2Heure-500Ar',
      kind: 'TICKET',
      status: 'ACTIVE',
      price: 500,
    });

    await service.retirerDuTarif('2Heure-500Ar', 'admin-1');

    expect(plan.update.mock.calls[0][0]).toMatchObject({ data: { status: 'ARCHIVED' } });
  });
});

// ==================== Suppression définitive ====================

function faussePlansService(
  offre: Record<string, unknown>,
  compteurs: { voucher?: number; voucherBatch?: number; payment?: number; subscription?: number },
) {
  const compte = (n = 0) => ({ count: vi.fn(async () => n) });
  const plan = {
    findUnique: vi.fn(async () => offre),
    delete: vi.fn(async () => offre),
  };
  const prisma: any = {
    scoped: {
      plan,
      voucher: compte(compteurs.voucher),
      voucherBatch: compte(compteurs.voucherBatch),
      payment: compte(compteurs.payment),
      subscription: compte(compteurs.subscription),
    },
  };
  const audit = { log: vi.fn(async () => undefined) };
  const service = new PlansService(prisma, {} as any, {} as any, audit as any);
  return { service, plan, audit };
}

const OFFRE = {
  id: 'plan-1',
  name: '1Jour-2000Ar-verify',
  mikrotikProfileName: '1JOUR-2000AR-VERIFY',
  price: { toString: () => '2000' },
};

describe('PlansService.supprimer', () => {
  it('supprime une offre que rien ne retient', async () => {
    const { service, plan, audit } = faussePlansService(OFFRE, {});

    await service.supprimer('plan-1', 'admin-1');

    expect(plan.delete).toHaveBeenCalledWith({ where: { id: 'plan-1' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE_PLAN', targetId: 'plan-1' }),
    );
  });

  it('refuse et nomme ce qui la retient', async () => {
    // Un paiement dont l'offre a disparu est une recette qu'on ne sait plus
    // rattacher à rien. La base refuserait de toute façon, avec un message
    // que personne ne peut lire ; celui-ci dit quoi faire à la place.
    const { service, plan } = faussePlansService(OFFRE, { payment: 3, voucher: 12 });

    await expect(service.supprimer('plan-1', 'admin-1')).rejects.toThrow(
      /12 ticket\(s\).*3 paiement\(s\).*[Aa]rchivez/s,
    );
    expect(plan.delete).not.toHaveBeenCalled();
  });

  it('refuse aussi pour un seul abonnement', async () => {
    const { service, plan } = faussePlansService(OFFRE, { subscription: 1 });

    await expect(service.supprimer('plan-1', 'admin-1')).rejects.toThrow(/1 abonnement/);
    expect(plan.delete).not.toHaveBeenCalled();
  });
});
