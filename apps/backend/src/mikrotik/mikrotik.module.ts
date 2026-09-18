import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  ConsoleLogger,
  RouterOSMikrotikService,
  RouterOSRestClient,
  type RouterOSClientConfig,
} from '@wifitati/mikrotik-service';
import { MIKROTIK_SERVICE } from './mikrotik.constants.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MIKROTIK_SERVICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const clientConfig: RouterOSClientConfig = {
          baseUrl: config.get<string>('MIKROTIK_BASE_URL', 'https://192.168.88.1'),
          username: config.get<string>('MIKROTIK_USERNAME', ''),
          password: config.get<string>('MIKROTIK_PASSWORD', ''),
        };
        const logger = new ConsoleLogger('mikrotik');
        const client = new RouterOSRestClient(clientConfig, logger);
        return new RouterOSMikrotikService(client, logger);
      },
    },
  ],
  exports: [MIKROTIK_SERVICE],
})
export class MikrotikModule {}
