import { Global, Module } from '@nestjs/common';
import { LOG_BUFFER } from './log-buffer.token';
import { logBuffer } from './log-buffer';

/**
 * Global : le tampon de logs se lit sans import, comme les réglages.
 *
 * Il est fourni par valeur et non construit par la DI — l'instance existe déjà,
 * posée sur le logger au démarrage. Le module ne fait que l'exposer ; c'est ce
 * qui permet à la CAPTURE de vivre hors du module `app-logs`, désactivable :
 * couper l'écran ne doit pas couper l'enregistrement, sinon rallumer l'écran
 * après un incident ne montrerait rien de l'incident.
 */
@Global()
@Module({
  providers: [{ provide: LOG_BUFFER, useValue: logBuffer }],
  exports: [LOG_BUFFER],
})
export class LoggingModule {}
