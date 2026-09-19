import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { PublicService } from './public.service.js';
import { normalizePhone, normalizeReference } from './payment-normalization.js';

/**
 * Le service public est le seul à travailler sans jeton. Il n'a donc aucune
 * barrière héritée : son cloisonnement tient entièrement à ce qu'il pose
 * lui-même. Ce test s'exécute contre la vraie base et doit échouer si un
 * exploitant voit quoi que ce soit d'un autre.
 */
describe('PublicService', () => {
  const tenantContext = new TenantContextService();
  const prisma = new PrismaService(tenantContext);
  const service = new PublicService(prisma, tenantContext);

  const suffix = Date.now();
  const tenantA = `pub-a-${suffix}`;
  const tenantB = `pub-b-${suffix}`;
  let planB = '';
  let accountA = '';

  beforeAll(async () => {
    await prisma.$connect();

    for (const [id, name] of [
      [tenantA, 'Public A'],
      [tenantB, 'Public B'],
    ]) {
      await prisma.tenant.create({
        data: { id, slug: id, name, wifiName: name, currency: 'MGA', status: 'ACTIVE' },
      });
    }
    // Un exploitant en attente : sa page ne doit pas être en ligne.
    await prisma.tenant.create({
      data: {
        id: `pub-pending-${suffix}`,
        slug: `pub-pending-${suffix}`,
        name: 'En attente',
        wifiName: 'En attente',
        currency: 'MGA',
        status: 'PENDING',
      },
    });

    const makePlan = (tenantId: string, name: string) =>
      prisma.plan.create({
        data: {
          tenantId,
          name,
          price: 2000,
          validityDurationSeconds: 86_400,
          mikrotikProfileName: name,
          kind: 'TICKET',
          status: 'ACTIVE',
        },
      });
    await makePlan(tenantA, `PLAN-A-${suffix}`);
    planB = (await makePlan(tenantB, `PLAN-B-${suffix}`)).id;

    accountA = (
      await prisma.mobileMoneyAccount.create({
        data: {
          tenantId: tenantA,
          provider: 'MVOLA',
          phoneNumber: `034${suffix}`.slice(0, 10),
          accountName: 'Titulaire A',
          isActive: true,
        },
      })
    ).id;
    // Puce retirée : elle ne doit jamais être proposée au client.
    await prisma.mobileMoneyAccount.create({
      data: {
        tenantId: tenantA,
        provider: 'ORANGE_MONEY',
        phoneNumber: `032${suffix}`.slice(0, 10),
        accountName: 'Puce retirée',
        isActive: false,
      },
    });
  });

  afterAll(async () => {
    const ids = [tenantA, tenantB, `pub-pending-${suffix}`];
    await prisma.paymentClaim.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.payment.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.customer.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.mobileMoneyAccount.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.plan.deleteMany({ where: { tenantId: { in: ids } } });
    await prisma.tenant.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  describe('vitrine', () => {
    it("ne montre que les offres de l'exploitant demandé", async () => {
      const view = await service.getTenantView(tenantA);

      expect(view.plans).toHaveLength(1);
      expect(view.plans[0].name).toBe(`PLAN-A-${suffix}`);
    });

    it('cache les puces Mobile Money retirées', async () => {
      // Une puce désactivée continuerait sinon de recevoir de l'argent que
      // personne ne surveille.
      const view = await service.getTenantView(tenantA);

      expect(view.paymentAccounts).toHaveLength(1);
      expect(view.paymentAccounts[0].accountName).toBe('Titulaire A');
    });

    it("n'expose ni identifiant interne ni statut", async () => {
      const view = (await service.getTenantView(tenantA)) as unknown as Record<string, unknown>;

      expect(view.id).toBeUndefined();
      expect(view.status).toBeUndefined();
      expect(view.domains).toBeUndefined();
    });

    it("refuse un exploitant qui n'est pas activé", async () => {
      await expect(service.getTenantView(`pub-pending-${suffix}`)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('répond pareil pour un exploitant inconnu', async () => {
      // Ne pas distinguer les deux cas, pour ne pas révéler quels comptes
      // existent.
      await expect(service.getTenantView('inexistant')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('déclaration de paiement', () => {
    it("refuse l'offre d'un autre exploitant", async () => {
      // Un identifiant recopié depuis la page d'un concurrent ne doit pas
      // permettre d'acheter chez lui en passant par ici.
      await expect(
        service.claim(tenantA, {
          planId: planB,
          accountId: accountA,
          phone: '0340394188',
          reference: 'REF12345',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('enregistre un paiement en attente, sans rien ouvrir', async () => {
      const result = await service.claim(tenantA, {
        planId: (await service.getTenantView(tenantA)).plans[0].id,
        accountId: accountA,
        phone: '+261 34 03 941 88',
        reference: 'ab12-cd34',
      });

      expect(result.state).toBe('EN_ATTENTE');
      expect(result.token).toHaveLength(32);

      const claim = await service.getClaimByToken(tenantA, result.token);
      expect(claim.state).toBe('EN_ATTENTE');
      // Aucun code tant que le paiement n'est pas vérifié.
      expect(claim.accessCode).toBeNull();
    });

    it('rejoue la même déclaration sans créer un second paiement', async () => {
      const planId = (await service.getTenantView(tenantA)).plans[0].id;
      const first = await service.claim(tenantA, {
        planId,
        accountId: accountA,
        phone: '0330000001',
        reference: 'REPLAY99',
      });
      const second = await service.claim(tenantA, {
        planId,
        accountId: accountA,
        phone: '0330000001',
        reference: 'replay 99',
      });

      expect(second.token).toBe(first.token);
    });

    it('refuse une référence inexploitable', async () => {
      const planId = (await service.getTenantView(tenantA)).plans[0].id;
      await expect(
        service.claim(tenantA, {
          planId,
          accountId: accountA,
          phone: '0330000002',
          reference: '@@@',
        }),
      ).rejects.toThrow(/Référence invalide/);
    });
  });

  describe('recherche par numéro et référence', () => {
    it('retrouve un paiement déclaré, quelle que soit la graphie', async () => {
      const planId = (await service.getTenantView(tenantA)).plans[0].id;
      await service.claim(tenantA, {
        planId,
        accountId: accountA,
        phone: '0341111111',
        reference: 'XY-99-ZW',
      });

      // Le client retape son numéro autrement et sa référence en minuscules.
      const found = await service.lookup(tenantA, {
        phone: '+261341111111',
        reference: 'xy99zw',
      });

      expect(found.state).toBe('EN_ATTENTE');
    });

    it("ne trouve rien chez un autre exploitant", async () => {
      await expect(
        service.lookup(tenantB, { phone: '0341111111', reference: 'XY99ZW' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('normalisation partagée', () => {
  // Formulaire client et lecteur de SMS doivent normaliser à l'identique :
  // deux implémentations divergentes donneraient zéro rapprochement, sans
  // erreur ni trace.
  it('ramène toutes les écritures d\'un numéro à la même forme', () => {
    for (const written of ['+261 34 03 941 88', '0340394188', '261340394188', '034-03-941-88']) {
      expect(normalizePhone(written)).toBe('340394188');
    }
  });

  it('ramène une référence à ses caractères significatifs', () => {
    expect(normalizeReference('1a2b-3c4d')).toBe('1A2B3C4D');
    expect(normalizeReference(' 1A2B 3C4D ')).toBe('1A2B3C4D');
  });
});
