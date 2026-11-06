import { Global, Module } from '@nestjs/common';
import { Configuracion } from '../../config/environment.js';
import { AlmacenTokensDb } from '../../student-notifications/token-store.js';
import { EnviadorExpo } from '../../student-notifications/expo-sender.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Avisos } from './notices.service.js';
import { DispositivosControlador } from './devices.controller.js';
import { DispositivoEntidad } from './device.entity.js';
import { EnviadorRegistro } from './registry-sender.js';
import { AlmacenTokensPush, EnviadorPush } from './ports.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([DispositivoEntidad])],
  controllers: [DispositivosControlador],
  providers: [
    { provide: AlmacenTokensPush, useClass: AlmacenTokensDb },
    {
      provide: EnviadorPush,
      inject: [Configuracion],
      useFactory: (config: Configuracion): EnviadorPush =>
        config.notificaciones === 'expo'
          ? new EnviadorExpo(config.expoPushUrl)
          : new EnviadorRegistro(),
    },
    Avisos,
  ],
  exports: [Avisos],
})
export class NotificacionesModulo {}
