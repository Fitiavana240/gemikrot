import {
  mapHotspotServicePort,
  mapUmAttribute,
  mapUmRouter,
  mapUmUserGroup,
} from '../../src/mappers/router-config.mapper';

/**
 * Charges utiles **relevées sur le hAP ac² en RouterOS 7.24.4**, le
 * 2026-09-20. Recopiées champ pour champ, hors secret.
 */

describe('mapUmRouter', () => {
  const RELEVE = {
    '.id': '*1',
    address: '127.0.0.1',
    'coa-port': '3799',
    disabled: 'false',
    name: 'router',
    protocol: 'udp',
    'shared-secret': 'un-secret-quelconque',
  };

  it('ne fait jamais sortir le secret partagé', () => {
    // Il authentifie le routeur auprès de RADIUS : le laisser remonter
    // jusqu'au navigateur reviendrait à le publier. Seule sa présence sort.
    const rendu = mapUmRouter(RELEVE);
    expect(JSON.stringify(rendu)).not.toContain('un-secret-quelconque');
    expect(rendu.hasSharedSecret).toBe(true);
  });

  it('signale un secret absent plutôt que de le taire', () => {
    expect(mapUmRouter({ ...RELEVE, 'shared-secret': '' }).hasSharedSecret).toBe(false);
  });

  it('lit adresse, protocole et port de changement', () => {
    const rendu = mapUmRouter(RELEVE);
    expect(rendu.address).toBe('127.0.0.1');
    expect(rendu.protocol).toBe('udp');
    expect(rendu.coaPort).toBe(3799);
    expect(rendu.disabled).toBe(false);
  });
});

describe('mapUmUserGroup', () => {
  const RELEVE = {
    '.id': '*0',
    attributes: '',
    default: 'true',
    'default-name': 'default',
    'inner-auths': 'ttls-pap,ttls-chap,ttls-mschap1,ttls-mschap2,peap-mschap2',
    name: 'default',
    'outer-auths': 'pap,chap,mschap1,mschap2,eap-tls,eap-ttls,eap-peap,eap-mschap2',
  };

  it("découpe les méthodes d'authentification", () => {
    const groupe = mapUmUserGroup(RELEVE);
    expect(groupe.outerAuths).toContain('pap');
    expect(groupe.outerAuths).toContain('eap-tls');
    expect(groupe.innerAuths).toContain('ttls-pap');
    expect(groupe.outerAuths).toHaveLength(8);
  });

  it('marque les groupes livrés avec RouterOS', () => {
    // On ne supprime pas un groupe par défaut : le dire évite de proposer
    // une action qui échouera.
    expect(mapUmUserGroup(RELEVE).isDefault).toBe(true);
  });

  it('rend null des attributs vides plutôt qu\'une chaîne', () => {
    expect(mapUmUserGroup(RELEVE).attributes).toBeNull();
  });
});

describe('mapUmAttribute', () => {
  const RELEVE = {
    '.id': '*1',
    default: 'true',
    'default-name': 'Acct-Input-Octets',
    name: 'Acct-Input-Octets',
    'packet-types': 'accounting-request',
    'standard-name': 'Acct-Input-Octets',
    'type-id': '42',
    'value-type': 'integer',
  };

  it("distingue un attribut standard d'un attribut constructeur", () => {
    // Le routeur rend la chaîne « standard » plutôt que d'omettre le champ.
    // Trouvé en lisant le vrai routeur : l'écran affichait « constructeur
    // standard », ce qui ne veut rien dire.
    expect(mapUmAttribute({ ...RELEVE, 'vendor-id': 'standard' }).vendorId).toBeNull();
    const attribut = mapUmAttribute(RELEVE);
    expect(attribut.vendorId).toBeNull();
    expect(attribut.standardName).toBe('Acct-Input-Octets');
    expect(mapUmAttribute({ ...RELEVE, 'vendor-id': '14988' }).vendorId).toBe('14988');
  });

  it('lit le numéro de type et le genre de valeur', () => {
    const attribut = mapUmAttribute(RELEVE);
    expect(attribut.typeId).toBe(42);
    expect(attribut.valueType).toBe('integer');
    expect(attribut.packetTypes).toEqual(['accounting-request']);
  });
});

describe('mapHotspotServicePort', () => {
  it('lit le protocole suivi et ses ports', () => {
    const port = mapHotspotServicePort({
      '.id': '*1',
      disabled: 'false',
      name: 'ftp',
      ports: '21',
    });
    expect(port.name).toBe('ftp');
    expect(port.ports).toBe('21');
    expect(port.disabled).toBe(false);
  });
});
