import { describe, expect, it, vi } from 'vitest';
import { CourrielService } from './courriel.service.js';

/**
 * L'envoi de courriel, et surtout ce qu'il laisse derrière lui.
 *
 * Un envoi qui échoue en silence est pire que pas d'envoi : l'exploitant
 * croit avoir prévenu, le client n'a rien reçu, et personne ne le saura. Ces
 * épreuves fixent donc d'abord la trace, ensuite le message.
 */

/** Une clef de chiffrement d'essai : 32 octets, comme en production. */
const CLEF = 'a'.repeat(64);

function service(
  tenant: Record<string, unknown> | null = {
    smtpHost: 'smtp.exemple.mg',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: 'contact@exemple.mg',
    smtpFrom: 'Zone WIFI-TATI <contact@exemple.mg>',
    smtpActif: true,
    smtpPasswordEncrypted: null,
  },
) {
  const create = vi.fn(async ({ data }: any) => data);
  const update = vi.fn(async ({ data }: any) => data);
  const prisma: any = {
    tenant: { findUnique: vi.fn(async () => tenant), update },
    courriel: { create },
    scoped: { courriel: { findMany: vi.fn(async () => []) } },
  };
  const s = new CourrielService(
    prisma,
    { requireTenantId: () => 't1' } as never,
    { log: vi.fn(async () => undefined) } as never,
    { getOrThrow: () => CLEF } as never,
  );
  return { service: s, create, update };
}

describe('ce qui n’est pas envoyé laisse quand même une trace', () => {
  it('refuse d’envoyer tant que l’exploitant n’a pas activé', async () => {
    // Enregistrer une configuration ne doit pas suffire à écrire à des
    // clients : c'est un interrupteur, pas une conséquence.
    const { service: s, create } = service({
      smtpHost: 'smtp.exemple.mg',
      smtpFrom: 'a@b.mg',
      smtpActif: false,
      smtpPasswordEncrypted: null,
    });

    const r = await s.envoyer({
      destinataire: 'admin@exemple.mg',
      sujet: 'Essai',
      texte: 'x',
      type: 'essai',
    });

    expect(r.envoye).toBe(false);
    expect(r.erreur).toMatch(/pas activé/);
    // Et la ligne existe : sans elle, l'exploitant chercherait pourquoi rien
    // n'arrive sans jamais trouver que c'est lui qui n'a pas activé.
    expect(create).toHaveBeenCalledOnce();
    expect((create.mock.calls[0] as any)[0].data.statut).toBe('ECHEC');
  });

  it('trace l’absence de serveur plutôt que de partir dans le vide', async () => {
    const { service: s, create } = service({
      smtpHost: null,
      smtpFrom: null,
      smtpActif: true,
      smtpPasswordEncrypted: null,
    });

    const r = await s.envoyer({
      destinataire: 'admin@exemple.mg',
      sujet: 'Essai',
      texte: 'x',
      type: 'essai',
    });

    expect(r.envoye).toBe(false);
    expect((create.mock.calls[0] as any)[0].data.erreur).toMatch(/Serveur ou expéditeur/);
  });

  it('ne lève jamais : un courriel raté n’emporte pas ce qui l’a déclenché', async () => {
    // Un paiement vérifié qu'on annulerait parce que la confirmation n'est
    // pas partie serait absurde.
    const { service: s } = service({
      smtpHost: 'hote.invalide.test',
      smtpPort: 1,
      smtpSecure: false,
      smtpUser: null,
      smtpFrom: 'a@b.mg',
      smtpActif: true,
      smtpPasswordEncrypted: null,
    });

    await expect(
      s.envoyer({ destinataire: 'x@y.mg', sujet: 'S', texte: 't', type: 'essai' }),
    ).resolves.toMatchObject({ envoye: false });
  });
});

describe('le mot de passe', () => {
  it('ne revient jamais au navigateur', async () => {
    // On dit seulement qu'il y en a un : c'est ce qu'il faut savoir pour
    // décider s'il faut le ressaisir, et rien de plus.
    const { service: s } = service({
      smtpHost: 'smtp.exemple.mg',
      smtpActif: true,
      smtpPasswordEncrypted: 'AAA.BBB.CCC',
    });

    const r = await s.reglages();

    expect(r.motDePassePose).toBe(true);
    expect(JSON.stringify(r)).not.toContain('AAA.BBB.CCC');
  });

  it('survit à un aller-retour chiffré', async () => {
    const { service: s, update } = service();

    await s.enregistrer({ host: 'smtp.exemple.mg', motDePasse: 'secret-du-smtp' }, 'admin-1');

    const chiffre = (update.mock.calls[0] as any)[0].data.smtpPasswordEncrypted as string;
    expect(chiffre).not.toContain('secret-du-smtp');
    // Trois parties : vecteur, marque d'authenticité, contenu.
    expect(chiffre.split('.')).toHaveLength(3);
    expect((s as never as { dechiffrer(v: string): string })['dechiffrer'](chiffre)).toBe(
      'secret-du-smtp',
    );
  });

  it('n’est pas effacé quand on enregistre le reste', async () => {
    // L'écran ne le renvoie jamais : traiter un champ vide comme un
    // effacement le perdrait à chaque modification de l'expéditeur.
    const { service: s, update } = service();

    await s.enregistrer({ host: 'smtp.exemple.mg', from: 'a@b.mg' }, 'admin-1');

    expect((update.mock.calls[0] as any)[0].data).not.toHaveProperty('smtpPasswordEncrypted');
  });
});

describe('l’expéditeur', () => {
  it('refuse ce qui n’est pas une adresse', async () => {
    // Un expéditeur invalide fait refuser chaque message par le serveur
    // distant, et l'exploitant ne le découvrirait qu'au premier client.
    const { service: s } = service();

    await expect(s.enregistrer({ from: 'Zone WIFI-TATI' }, 'admin-1')).rejects.toThrow(/adresse/i);
  });

  it('accepte la forme avec nom', async () => {
    const { service: s } = service();

    await expect(
      s.enregistrer({ from: 'Zone WIFI-TATI <contact@wifitati.net>' }, 'admin-1'),
    ).resolves.toBeDefined();
  });
});

/**
 * << La plateforme sait-elle ecrire ? >> se pose avant de reclamer un code.
 *
 * Tant que la reponse est non, aucun code de confirmation ne peut arriver, et
 * un ecran qui en reclame un enferme celui qui le lit : il n'a rien fait de
 * travers, et aucun moyen de s'en sortir.
 */
describe('la plateforme sait-elle ecrire', () => {
  function plateforme(p: Record<string, unknown> | null) {
    const prisma: any = {
      tenant: { findUnique: vi.fn(async () => null), update: vi.fn() },
      courriel: { create: vi.fn(async ({ data }: any) => data) },
      plateforme: { findUnique: vi.fn(async () => p) },
      scoped: { courriel: { findMany: vi.fn(async () => []) } },
    };
    return new CourrielService(
      prisma,
      { requireTenantId: () => 't1' } as never,
      { log: vi.fn(async () => undefined) } as never,
      { getOrThrow: () => CLEF } as never,
    );
  }

  it('non quand rien n’est enregistre', async () => {
    await expect(plateforme(null).plateformePeutEcrire()).resolves.toBe(false);
  });

  it('non quand l’interrupteur est eteint', async () => {
    const s = plateforme({ smtpActif: false, smtpHost: 'smtp.exemple.mg', smtpFrom: 'a@b.mg' });
    await expect(s.plateformePeutEcrire()).resolves.toBe(false);
  });

  it('non quand l’interrupteur est allume sur une configuration vide', async () => {
    // Les memes trois conditions que l'envoi lui-meme : un interrupteur
    // allume sur un serveur absent n'envoie pas davantage qu'un eteint, et
    // repondre << oui >> ferait reclamer un code qui ne partira jamais.
    const s = plateforme({ smtpActif: true, smtpHost: null, smtpFrom: null });
    await expect(s.plateformePeutEcrire()).resolves.toBe(false);
  });

  it('oui quand les trois sont reunies', async () => {
    const s = plateforme({ smtpActif: true, smtpHost: 'smtp.exemple.mg', smtpFrom: 'a@b.mg' });
    await expect(s.plateformePeutEcrire()).resolves.toBe(true);
  });
});
