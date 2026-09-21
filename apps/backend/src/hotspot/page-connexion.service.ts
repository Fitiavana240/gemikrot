import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../tenancy/tenant-context.service.js';
import { MikrotikClientFactory } from '../routers/mikrotik-client.factory.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * La page de connexion du portail captif, remplie et poussée sur le routeur.
 *
 * C'est le maillon qui manquait au parcours d'achat. Le Walled Garden
 * laissait déjà passer la page de paiement — l'entrée existe, avec le bon
 * port — mais **elle n'était comptée à zéro visite**, faute de lien : un
 * client sans code voyait une page qui ne lui proposait rien, et devait
 * trouver le vendeur.
 *
 * Le paiement ne demande **aucun accès Internet** : la page est servie sur le
 * réseau local, le client la joint par le Wi-Fi seul, et l'argent part par
 * Mobile Money, hors du routeur.
 *
 * **La page est un fichier statique.** Elle pourrait interroger
 * l'application pour afficher les offres, mais elle est servie depuis le
 * routeur : l'appel serait inter-origine et le navigateur le refuserait.
 * Surtout, une page de connexion ne doit avoir aucun mode de panne — si la
 * liste ne répond pas, plus personne ne se connecte.
 */

/** Là où RouterOS sert la page du portail. */
const CHEMIN_ROUTEUR = 'flash/hotspot/login.html';

const ICI = dirname(fileURLToPath(import.meta.url));

/**
 * Le modèle, cherché depuis la racine du dépôt.
 *
 * Deux chemins parce que le code tourne depuis `src/` en développement et
 * depuis `dist/` une fois compilé : chercher au seul endroit du moment
 * marcherait chez soi et échouerait en production.
 */
const CHEMINS_MODELE = [
  resolve(ICI, '../../../../hotspot/login.html'),
  resolve(ICI, '../../../../../hotspot/login.html'),
];

@Injectable()
export class PageConnexionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly clients: MikrotikClientFactory,
    private readonly audit: AuditService,
  ) {}

  private async modèle(): Promise<string> {
    for (const chemin of CHEMINS_MODELE) {
      try {
        return await readFile(chemin, 'utf8');
      } catch {
        /* essai suivant */
      }
    }
    throw new NotFoundException(
      "Le modèle de page de connexion est introuvable (hotspot/login.html)",
    );
  }

  /**
   * La page telle qu'elle sera écrite, sans rien envoyer.
   *
   * Prévisualiser avant d'écraser n'est pas un luxe : une page fautive sur le
   * routeur, et **plus personne ne se connecte** — ni les clients déjà
   * payants, ni ceux qui viennent d'acheter.
   */
  async apercu(portailUrl: string): Promise<{ contenu: string; chemin: string; octets: number }> {
    const tenantId = this.tenantContext.requireTenantId();
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, wifiName: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Exploitant introuvable');

    // La barre finale se glisse une fois sur deux dans un champ d'adresse, et
    // donnerait « http://hote//p/slug ».
    const base = portailUrl.trim().replace(/\/+$/, '');

    const contenu = (await this.modèle())
      .replaceAll('__MARQUE__', échapper(tenant.wifiName))
      .replaceAll('__LIEU__', échapper(tenant.name))
      .replaceAll('__PORTAIL__', échapper(base))
      .replaceAll('__SLUG__', échapper(tenant.slug));

    return { contenu, chemin: CHEMIN_ROUTEUR, octets: contenu.length };
  }

  /**
   * Écrit la page sur le routeur, en écrasant celle qui s'y trouve.
   *
   * Le geste est tracé, et il ne se défait pas : RouterOS ne garde pas de
   * version précédente d'un fichier remplacé.
   */
  async publier(
    portailUrl: string,
    adminUserId: string,
    routerId?: string,
  ): Promise<{ chemin: string; octets: number }> {
    const { contenu, chemin, octets } = await this.apercu(portailUrl);

    const mikrotik = routerId
      ? await this.clients.forRouter(routerId)
      : await this.clients.forDefaultRouter();
    await mikrotik.writeRouterFile(chemin, contenu);

    await this.audit.log({
      adminUserId,
      routerId,
      action: 'PUBLISH_LOGIN_PAGE',
      targetType: 'Router',
      targetId: routerId ?? 'defaut',
      payloadDiff: { chemin, octets, portail: portailUrl },
    });

    return { chemin, octets };
  }
}

/**
 * Ce que l'exploitant a saisi entre dans du HTML : il doit en sortir inerte.
 *
 * Un nom de réseau contenant `"` ou `<` casserait l'attribut ou la balise
 * qui le porte — et la page de connexion est précisément celle qu'on ne peut
 * pas se permettre de casser. Les accents, eux, deviennent des entités :
 * l'API du routeur refuse tout octet au-dessus de 127.
 */
function échapper(texte: string): string {
  return [...texte]
    .map((c) => {
      if (c === '&') return '&amp;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      if (c === '"') return '&quot;';
      if (c === "'") return '&#39;';
      return c.charCodeAt(0) > 127 ? `&#${c.charCodeAt(0)};` : c;
    })
    .join('');
}
