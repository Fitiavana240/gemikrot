import { Module } from '@nestjs/common';
import { CourrielModule } from '../courriel/courriel.module.js';
import { HotspotModule } from '../hotspot/hotspot.module.js';
import { PublicService } from './public.service.js';
import { PublicController } from './public.controller.js';

@Module({
  // `CourrielModule` : prevenir les administrateurs qu'un client attend son
  // code. `HotspotModule` : servir la page captive que le routeur va
  // chercher lui-meme, plutot que de la faire coller a la main.
  imports: [CourrielModule, HotspotModule],
  controllers: [PublicController],
  providers: [PublicService],
  exports: [PublicService],
})
export class PublicModule {}
