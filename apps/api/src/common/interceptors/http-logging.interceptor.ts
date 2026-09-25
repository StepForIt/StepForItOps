import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';

/** Au-delà, une lecture mérite sa ligne de log même si elle a réussi. */
const SLOW_READ_MS = 2_000;

/**
 * Une ligne par requête terminée, avec sa durée : sans elle, une vérification de
 * masse ne laissait aucune trace dans les logs du conteneur. Les lectures rapides
 * (listes, polling UI) restent silencieuses pour ne pas noyer les traitements longs.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const started = Date.now();

    // `close` plutôt que `finish` : il se déclenche aussi quand le navigateur
    // coupe (onglet fermé en plein run de masse), cas qu'on veut justement voir.
    response.once('close', () => {
      const elapsed = Date.now() - started;
      if (request.method === 'GET' && elapsed < SLOW_READ_MS && response.writableEnded) return;
      const outcome = response.writableEnded ? response.statusCode : 'interrompu';
      const line = `${request.method} ${request.originalUrl} → ${outcome} en ${(elapsed / 1000).toFixed(1)} s`;
      if (!response.writableEnded || response.statusCode >= 400) this.logger.warn(line);
      else this.logger.log(line);
    });

    return next.handle();
  }
}
