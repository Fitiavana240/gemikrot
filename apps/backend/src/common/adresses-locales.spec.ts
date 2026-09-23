import { describe, expect, it } from 'vitest';
import {
  adressePerimee,
  estIPv4,
  hoteDeLUrl,
  memeReseau24,
} from './adresses-locales.js';

/**
 * L'adresse de la console, écrite dans des fichiers qui vivent ailleurs.
 *
 * Deux fois sur cette installation, un bail DHCP a glissé et tout a cessé de
 * fonctionner en silence : la page captive envoyait les clients sur une
 * adresse morte, puis le script d'enrôlement faisait appeler le routeur dans
 * le vide. Ce qui se vérifie ici, c'est qu'on sache le dire **avant**.
 */

const LOCALES = ['192.168.88.23', '172.27.112.1', '172.18.80.1'];

describe('adressePerimee', () => {
  it('ne dit rien quand la machine porte bien cette adresse', () => {
    expect(adressePerimee('192.168.88.23', LOCALES)).toBeNull();
  });

  it('propose la nouvelle adresse du même réseau', () => {
    // Le cas exact de cette installation : le `.env` annonçait `.135`, la
    // console répondait sur `.23`.
    expect(adressePerimee('192.168.88.135', LOCALES)).toEqual({
      configuree: '192.168.88.135',
      actuelle: '192.168.88.23',
    });
  });

  it('ne propose rien plutôt qu’une carte virtuelle', () => {
    // Hyper-V et WSL sont bien des adresses de cette machine, et parfaitement
    // injoignables depuis le Wi-Fi. Mieux vaut se taire que proposer faux.
    expect(adressePerimee('10.0.0.5', LOCALES)).toEqual({
      configuree: '10.0.0.5',
      actuelle: null,
    });
  });

  it('laisse un nom de domaine tranquille', () => {
    // Une mise en production sérieuse annonce `console.exemple.net`, que cette
    // machine ne porte évidemment sur aucune carte. La signaler périmée
    // crierait au loup à chaque déploiement réussi.
    expect(adressePerimee('console.exemple.net', LOCALES)).toBeNull();
    expect(adressePerimee('localhost', LOCALES)).toBeNull();
  });
});

describe('estIPv4', () => {
  it('reconnaît une adresse et rejette le reste', () => {
    expect(estIPv4('192.168.88.23')).toBe(true);
    expect(estIPv4('10.0.0.1')).toBe(true);
    expect(estIPv4('192.168.88')).toBe(false);
    expect(estIPv4('192.168.88.999')).toBe(false);
    expect(estIPv4('wifitati.net')).toBe(false);
  });
});

describe('memeReseau24', () => {
  it('compare les trois premiers octets', () => {
    expect(memeReseau24('192.168.88.135', '192.168.88.1')).toBe(true);
    expect(memeReseau24('172.20.128.1', '192.168.88.1')).toBe(false);
    expect(memeReseau24('pas-une-adresse', '192.168.88.1')).toBe(false);
  });
});

describe('hoteDeLUrl', () => {
  it('retire le schéma et le port', () => {
    expect(hoteDeLUrl('http://192.168.88.135:3000')).toBe('192.168.88.135');
    expect(hoteDeLUrl('https://console.exemple.net/api')).toBe('console.exemple.net');
  });

  it('rend une chaîne vide sur une adresse illisible', () => {
    // Un `.env` mal rempli ne doit pas faire échouer la préparation d'un
    // script : on ne vérifie rien, on ne casse rien.
    expect(hoteDeLUrl('pas une url')).toBe('');
    expect(hoteDeLUrl('')).toBe('');
  });
});
