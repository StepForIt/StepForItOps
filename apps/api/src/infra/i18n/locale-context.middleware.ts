import { Injectable, NestMiddleware } from '@nestjs/common';
import { LOCALE_HEADER, isLocale, localeFromAcceptLanguage } from '@nwm/core';
import { NextFunction, Request, Response } from 'express';
import { runWithLocale } from './locale-context';

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * La console pose `x-locale` (choix de l'utilisateur, sinon son navigateur) ; un appel
 * direct n'a que son `Accept-Language`. Sans l'un ni l'autre, la langue de la plateforme.
 */
@Injectable()
export class LocaleContextMiddleware implements NestMiddleware {
  use(request: Request, _response: Response, next: NextFunction): void {
    const explicit = header(request, LOCALE_HEADER);
    const locale = isLocale(explicit)
      ? explicit
      : localeFromAcceptLanguage(header(request, 'accept-language'));
    if (!locale) return next();
    runWithLocale(locale, next);
  }
}
