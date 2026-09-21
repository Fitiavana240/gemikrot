import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DashboardService } from './dashboard.service.js';
import { RecettesService, type Pas } from './recettes.service.js';

/**
 * Une periode lue depuis l'URL, avec des bornes qui ne trompent pas.
 *
 * `au` est porte a la fin de la journee : sans cela, `au=2026-09-21` exclut
 * tout ce qui est entre apres minuit, c'est-a-dire la journee entiere. Le
 * defaut couvre le mois en cours, qui est la question la plus posee.
 */
function periode(du?: string, au?: string): { du: Date; au: Date } {
  const maintenant = new Date();
  const debut = du ? new Date(du) : new Date(maintenant.getFullYear(), maintenant.getMonth(), 1);
  const fin = au ? new Date(au) : maintenant;
  if (au) fin.setHours(23, 59, 59, 999);
  // Des bornes illisibles rendraient un tableau vide sans rien dire : on
  // retombe alors sur le mois en cours plutot que de mentir par le silence.
  const valide = (d: Date) => !Number.isNaN(d.getTime());
  return {
    du: valide(debut) ? debut : new Date(maintenant.getFullYear(), maintenant.getMonth(), 1),
    au: valide(fin) ? fin : maintenant,
  };
}

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly recettes: RecettesService,
  ) {}

  @Get('summary')
  getSummary() {
    return this.dashboardService.getSummary();
  }

  /** STAT-2 : la recette par offre et par periode. */
  @Get('recette')
  recette(@Query('du') du?: string, @Query('au') au?: string, @Query('pas') pas?: string) {
    const bornes = periode(du, au);
    const cadence: Pas = pas === 'mois' || pas === 'semaine' ? pas : 'jour';
    return this.recettes.recette(bornes.du, bornes.au, cadence);
  }

  /**
   * STAT-5 : l'export comptable des paiements.
   *
   * Rendu en piece jointe plutot qu'affiche : un CSV ouvert dans le
   * navigateur devient une bouillie qu'il faut ensuite recopier.
   */
  @Get('recette/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @Res({ passthrough: true }) res: Response,
    @Query('du') du?: string,
    @Query('au') au?: string,
  ) {
    const bornes = periode(du, au);
    const nom = `paiements-${bornes.du.toISOString().slice(0, 10)}_${bornes.au
      .toISOString()
      .slice(0, 10)}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    return this.recettes.csv(bornes.du, bornes.au);
  }
}
