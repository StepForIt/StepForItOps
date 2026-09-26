import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { msg } from '@nwm/core';
import { Request, Response } from 'express';
import { N8nAuthRefusedException, httpExceptionFromN8n } from './n8n-error.mapper';
import { httpExceptionFromPrisma } from './prisma-error.mapper';
import { captureHttpError } from '../../infra/sentry/sentry';

/** Nombre de lignes de stack renvoyées en mode debug (assez pour situer, pas un roman). */
const STACK_LINES = 15;

function isDebug(): boolean {
  const flag = process.env.DEBUG_ERRORS?.toLowerCase();
  return flag === '1' || flag === 'true';
}

/**
 * Filtre global : toute exception non HTTP devient un 500 dont la cause réelle
 * est TOUJOURS journalisée (méthode + URL + message + stack).
 *
 * Avec `DEBUG_ERRORS=1` (posé en dev par docker-compose.override.yml), la cause
 * est aussi renvoyée dans le corps de la réponse — l'UI affiche alors le vrai
 * message au lieu d'un « Internal server error » opaque. Jamais activé en prod.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Cause réelle et stack : toujours celles de l'exception d'origine, même
    // quand elle est traduite (tri invalide → 400 au lieu d'un 500 opaque).
    const detail = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;
    const translated =
      exception instanceof HttpException
        ? exception
        : (httpExceptionFromPrisma(exception) ?? httpExceptionFromN8n(exception));

    const status = translated ? translated.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = translated
      ? translated.getResponse()
      : { statusCode: status, message: msg('common.internalError') };
    const body: Record<string, unknown> =
      typeof payload === 'string' ? { statusCode: status, message: payload } : { ...payload };

    // Une erreur traduite en 4xx reste tracée : le message rendu au client est
    // volontairement court, le détail (requête Prisma complète…) va dans les logs.
    if (status < HttpStatus.INTERNAL_SERVER_ERROR && translated !== exception) {
      this.logger.warn(`${request.method} ${request.originalUrl} → ${status} : ${detail}`);
    }
    if (translated instanceof N8nAuthRefusedException) {
      this.logger.warn(`${request.method} ${request.originalUrl} → ${status} : ${detail}`);
    } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${request.method} ${request.originalUrl} → ${status} : ${detail}`, stack);
      // Seulement les 5xx : un 404 ou un 409 est une réponse, pas une panne, et
      // les remonter noierait les vraies pannes dans le bruit du quotidien.
      captureHttpError(
        exception,
        { method: request.method, path: request.route?.path ?? request.path },
        status,
      );
      if (isDebug()) {
        body.message = detail;
        body.error = exception instanceof Error ? exception.name : 'Error';
        body.path = request.originalUrl;
        body.stack = stack?.split('\n').slice(0, STACK_LINES);
      }
    }

    response.status(status).json(body);
  }
}
