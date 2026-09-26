import { timingSafeEqual } from 'crypto';
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { msg } from '@nwm/core';
import { PUBLIC_ROUTE_KEY } from './public-route.decorator';

/**
 * Jeton d'accès partagé entre le front et l'API.
 *
 * L'authentification des humains est portée par le front (session Google /
 * mot de passe, cf. apps/web/src/middleware.ts). Mais l'API peut être exposée
 * sur son propre domaine — c'est même requis quand n8n est à l'extérieur et
 * doit poster ses heartbeats. Sans ce garde, ce domaine offrirait toute la
 * plateforme en accès anonyme.
 *
 * Le proxy Next injecte `x-api-token` sur les appels `/backend/*` : le jeton
 * reste serveur-à-serveur, le navigateur ne le voit jamais.
 *
 * `API_ACCESS_TOKEN` absent → garde inactif (dev local, aucune rupture).
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.API_ACCESS_TOKEN;
    if (!expected) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const provided = request.headers['x-api-token'];
    if (typeof provided === 'string' && equals(provided, expected)) return true;

    throw new UnauthorizedException(msg('common.apiTokenInvalid'));
  }
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual exige des longueurs égales : on la teste à part (elle ne
  // révèle que la longueur du jeton, pas son contenu).
  return left.length === right.length && timingSafeEqual(left, right);
}
