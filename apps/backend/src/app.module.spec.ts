import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';

/**
 * L'application se monte-t-elle ?
 *
 * Ni la vérification de types ni les tests unitaires ne répondent à cette
 * question : un service qui demande une dépendance absente de son module
 * compile parfaitement, et chaque test qui l'instancie à la main lui passe
 * ses simulacres. L'erreur n'apparaît qu'au démarrage.
 *
 * Elle est arrivée : `RapprochementProfilsService` demandait `AuditService`
 * sans que `PlansModule` importe `AuditModule`. `tsc` propre, 261 tests au
 * vert, et l'application refusait de démarrer — toute la console renvoyait
 * 502, jusqu'à l'écran de connexion.
 *
 * `compile()` suffit et c'est délibéré : il résout le graphe entier et
 * instancie les fournisseurs, sans déclencher `onModuleInit` — donc sans
 * ouvrir de connexion ni lancer l'ordonnanceur. On éprouve le câblage, pas
 * l'environnement.
 */
describe('AppModule', () => {
  it('résout toutes ses dépendances', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(module).toBeDefined();
    await module.close();
  });
});
