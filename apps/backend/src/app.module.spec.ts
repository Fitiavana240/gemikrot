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
 *
 * **Trente secondes, et non les cinq par défaut.** Monter le graphe entier
 * coûte une seconde à vide et davantage quand la suite tourne en parallèle ;
 * l'épreuve tombait alors pour lenteur en annonçant une dépendance non
 * résolue. Un garde-fou qui crie au loup sous charge finit par se contourner,
 * et c'est le jour où le câblage est vraiment casse qu'on ne le croira pas.
 */
describe('AppModule', () => {
  it('résout toutes ses dépendances', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(module).toBeDefined();
    await module.close();
  }, 30_000);
});
