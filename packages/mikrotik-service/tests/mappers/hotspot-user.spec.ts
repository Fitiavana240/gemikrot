import { mapHotspotUser } from '../../src/mappers/hotspot.mapper';

/**
 * Charge utile **relevee sur le hAP ac2 en RouterOS 7.24.4**, le 2026-09-20,
 * sur `/ip/hotspot/user`. Recopiee champ pour champ.
 *
 * Deux choses que seul le relevé apprend. Le mot de passe revient masque en
 * « ***** » : le compte applicatif n'a pas la politique `sensitive`, et c'est
 * voulu — l'application n'a jamais besoin de relire un mot de passe. Et
 * `limit-uptime` est **absent** tant qu'aucun plafond n'est pose, ce qui
 * explique la colonne vide dans WinBox : c'est `null`, pas zero.
 */
const RELEVE = {
  '.id': '*7',
  'bytes-in': '1348615292',
  'bytes-out': '26175014794',
  comment: 'Ragnetre',
  disabled: 'false',
  dynamic: 'false',
  name: 'Soaragnetre',
  'packets-in': '13204379',
  'packets-out': '20390047',
  password: '*****',
  profile: '1Mois-15000Ar',
  server: 'hotspot-tati',
  uptime: '5d4h44m52s',
};

describe('mapHotspotUser', () => {
  const compte = mapHotspotUser(RELEVE);

  it('lit le trafic consomme', () => {
    expect(compte.bytesIn).toBe(1_348_615_292);
    expect(compte.bytesOut).toBe(26_175_014_794);
  });

  it('convertit la duree consommee en secondes', () => {
    // 5 jours, 4 heures, 44 minutes, 52 secondes.
    expect(compte.uptimeSeconds).toBe(5 * 86400 + 4 * 3600 + 44 * 60 + 52);
  });

  it('ne confond pas le plafond absent avec un plafond nul', () => {
    // WinBox montre une colonne « Limit Uptime » vide : le champ n'existe pas
    // tant qu'aucun plafond n'est pose. Le rendre a zero interdirait tout.
    expect(compte.limitUptimeSeconds).toBeNull();
    expect(compte.limitBytesIn).toBeNull();
    expect(mapHotspotUser({ ...RELEVE, 'limit-uptime': '1h' }).limitUptimeSeconds).toBe(3600);
  });

  it('garde le commentaire, qui porte le nom du client', () => {
    // Sur ce parc, le commentaire du compte est le nom de la personne :
    // c'est la seule facon de rattacher un compte HotSpot a quelqu'un.
    expect(compte.comment).toBe('Ragnetre');
    expect(compte.username).toBe('Soaragnetre');
  });

  it('rend un compte neuf sans trafic plutot que des valeurs absentes', () => {
    const neuf = mapHotspotUser({ '.id': '*1', name: 'KF77', profile: '1Jour' });
    expect(neuf.bytesIn).toBe(0);
    expect(neuf.uptimeSeconds).toBe(0);
    expect(neuf.disabled).toBe(false);
  });
});
