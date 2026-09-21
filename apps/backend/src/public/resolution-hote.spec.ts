import { describe, expect, it, vi } from 'vitest';
import { normaliserHote, PublicService } from './public.service.js';

/**
 * L'adresse par laquelle on est arrivé, et à qui elle appartient.
 *
 * Les domaines étaient enregistrés depuis le début — ils s'impriment même sur
 * le QR des tickets — et rien ne s'en servait pour répondre. Un client qui
 * tapait l'adresse de son fournisseur tombait sur l'écran de connexion de la
 * console : un formulaire qui lui demande un mot de passe qu'il n'a pas.
 */

describe('normaliserHote', () => {
  it('enlève le port et la casse', () => {
    // Le navigateur envoie le port, les réglages n'en portent jamais : sans
    // cela, les deux ne se rencontrent jamais et la résolution échoue en
    // silence, ce qui est la pire façon d'échouer ici.
    expect(normaliserHote('WifiTati.NET:8080')).toBe('wifitati.net');
  });

  it('refuse localhost et les adresses IP', () => {
    // La console de développement répond sur `localhost`, et le portail
    // captif sert la console par son adresse IP. Les laisser résoudre vers
    // une vitrine rendrait l'écran de connexion inatteignable.
    expect(normaliserHote('localhost')).toBe('');
    expect(normaliserHote('localhost:5173')).toBe('');
    expect(normaliserHote('192.168.88.135')).toBe('');
    expect(normaliserHote('192.168.88.135:5173')).toBe('');
    expect(normaliserHote('[::1]:5173')).toBe('');
  });

  it('refuse ce qui ne peut pas être un domaine', () => {
    expect(normaliserHote(undefined)).toBe('');
    expect(normaliserHote('   ')).toBe('');
    expect(normaliserHote('serveur')).toBe('');
  });
});

function service(
  trouvé: { slug: string } | null,
  declarations: unknown[] = [],
) {
  const findFirst = vi.fn(async () => trouvé);
  const prisma: any = {
    tenant: { findFirst },
    hotspotLoginPage: { findMany: vi.fn(async () => declarations) },
  };
  return {
    service: new PublicService(prisma, {} as never),
    findFirst,
  };
}

/** Ce que l'exploitant a déclaré comme adresse de sa page de paiement. */
const declare = (portailUrl: string, slug = 'zone-wifi-tati', status = 'ACTIVE') => ({
  portailUrl,
  tenant: { slug, status },
});

describe('l’adresse déclarée comme page de paiement', () => {
  it('résout une adresse IP, que la voie des domaines écarte', async () => {
    // C'est ce qui permet au bouton du portail captif de pointer sur une
    // adresse nue, sans `/p/<identifiant>` à la traîne. Ce n'est plus une
    // supposition sur une IP : l'exploitant l'a désignée dans ses réglages.
    const { service: s } = service(null, [declare('http://192.168.88.135:5173')]);

    expect(await s.slugParHote('192.168.88.135:5173')).toEqual({ slug: 'zone-wifi-tati' });
  });

  it('distingue le port', async () => {
    // La console et la page de paiement vivent sur la même machine. Sans le
    // port, ouvrir la console renverrait sur la page de paiement.
    const { service: s } = service(null, [declare('http://192.168.88.135:5173')]);

    expect(await s.slugParHote('192.168.88.135:3000')).toBeNull();
  });

  it('ignore un exploitant suspendu', async () => {
    const { service: s } = service(null, [
      declare('http://192.168.88.135:5173', 'zone-wifi-tati', 'SUSPENDED'),
    ]);

    expect(await s.slugParHote('192.168.88.135:5173')).toBeNull();
  });
});

describe('PublicService.slugParHote', () => {
  it('rend le slug de l’exploitant', async () => {
    const { service: s, findFirst } = service({ slug: 'zone-wifi-tati' });

    expect(await s.slugParHote('wifitati.net')).toEqual({ slug: 'zone-wifi-tati' });
    // Seuls les exploitants actifs répondent : un compte suspendu ne doit pas
    // continuer d'encaisser par sa vitrine.
    expect((findFirst.mock.calls[0] as any)[0].where.status).toBe('ACTIVE');
  });

  it('accepte le domaine nu comme le www', async () => {
    // Les deux désignent le même site pour qui les tape. En enregistrer un
    // seul et se voir refuser l'autre serait incompréhensible.
    const { service: s, findFirst } = service({ slug: 'zone-wifi-tati' });

    await s.slugParHote('www.wifitati.net');

    expect((findFirst.mock.calls[0] as any)[0].where.domains.hasSome).toEqual([
      'www.wifitati.net',
      'wifitati.net',
    ]);
  });

  it('ne cherche même pas pour un hôte impossible', async () => {
    // Pas seulement « rend null » : aucune requête ne part. Le chargement de
    // la console en développement ne doit rien coûter à la base.
    const { service: s, findFirst } = service(null);

    expect(await s.slugParHote('localhost:5173')).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rend null quand l’adresse n’est celle de personne', async () => {
    const { service: s } = service(null);

    expect(await s.slugParHote('console.exemple.mg')).toBeNull();
  });
});
