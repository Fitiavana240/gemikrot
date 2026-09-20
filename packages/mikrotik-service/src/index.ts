// Point d'entrée public de la couche d'abstraction MikroTik.
// Le reste du backend (contrôleurs, services métier) importe UNIQUEMENT
// depuis ce fichier — jamais un chemin interne (`./client/...`,
// `./mappers/...`) — afin que l'interface reste le seul point de couplage.

export type { IMikrotikService } from './interfaces/mikrotik-service.interface';

export * from './dto/router.dto';
export * from './dto/hotspot.dto';
export * from './dto/user-manager.dto';
export * from './dto/commands.dto';
export * from './dto/ppp.dto';
export * from './dto/router-config.dto';
export * from './dto/router-tools.dto';

export * from './errors/mikrotik.errors';

export { RouterOSMikrotikService } from './routeros-mikrotik.service';
export { RouterOSRestClient } from './client/routeros-rest-client';
export { ConsoleLogger } from './logging/console-logger';
export type { ILogger, LogContext } from './logging/logger.interface';
export type { RouterOSClientConfig } from './config/mikrotik-client.config';
