import './register-aliases';
// Avant tout le reste : le SDK s'installe sur http/express au chargement.
import './infra/sentry/instrument';
import { Server } from 'http';
import { json, urlencoded } from 'express';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { buildAppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { BufferedLogger } from './infra/logging/buffered-logger';
import { logBuffer } from './infra/logging/log-buffer';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { flushSentry, isSentryEnabled } from './infra/sentry/sentry';

async function bootstrap(): Promise<void> {
  const logger = new BufferedLogger(logBuffer);
  // Avant le chargement des modules, et pas seulement avant `create` : c'est
  // `loadFeatureModules` qui dit quel module n'a pas été chargé et pourquoi.
  Logger.overrideLogger(logger);
  const appModule = await buildAppModule();
  const app = await NestFactory.create(appModule, { logger });
  // Express plafonne les corps JSON à 100 ko : une capture d'écran jointe au chat
  // les dépasse d'un ordre de grandeur, et le refus arrive en 413 illisible.
  // La borne couvre le maximum autorisé côté chat : 4 images de 5 Mo, en base64.
  app.use(json({ limit: '32mb' }));
  app.use(urlencoded({ extended: true, limit: '32mb' }));
  // Cause réelle des 500 journalisée, et renvoyée à l'UI si DEBUG_ERRORS=1 (dev).
  app.useGlobalFilters(new AllExceptionsFilter());
  // Une ligne par traitement, durée comprise : sans elle, un run de masse ne
  // laisse rien voir dans les logs du conteneur.
  app.useGlobalInterceptors(new HttpLoggingInterceptor());
  // WEB_ORIGIN vide ou absent → toutes origines (usage local). En prod : liste CSV d'origines.
  const origins = process.env.WEB_ORIGIN?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins?.length ? origins : true,
    exposedHeaders: ['x-total-count'],
  });
  // Node coupe la socket à 5 min par défaut : les traitements de masse sont plus
  // longs et l'UI recevait un 500 « socket hang up » (puis un reclic concurrent)
  // alors que le serveur finissait. `headersTimeout` reste au-dessus.
  const server = app.getHttpServer() as Server;
  server.requestTimeout = 30 * 60 * 1000;
  server.headersTimeout = 31 * 60 * 1000;

  // Un arrêt brutal emporte la file d'envoi : les erreurs de la dernière seconde
  // sont justement celles qui expliquent l'arrêt. Posé seulement quand Sentry
  // sert : sans DSN, l'arrêt reste exactement celui d'avant.
  if (isSentryEnabled()) {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.once(signal, () => {
        void flushSentry().finally(() => process.exit(0));
      });
    }
  }

  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
  if (isSentryEnabled()) {
    // eslint-disable-next-line no-console
    console.log('Sentry enabled (errors reported to SENTRY_DSN).');
  }
  if (!process.env.API_ACCESS_TOKEN) {
    // Fail-open assumé en dev local, mais jamais silencieux : sur un serveur,
    // une API joignable sans jeton expose toute la plateforme anonymement.
    // eslint-disable-next-line no-console
    console.warn(
      '⚠️  API_ACCESS_TOKEN is not set: the API accepts every call without authentication. ' +
        'Set it as soon as this port is reachable beyond the local machine.',
    );
  }
}

void bootstrap();
