// Chargé dans le navigateur par le plugin Sentry (cf. next.config.js).
import * as Sentry from '@sentry/nextjs';
import { sentryOptions, webDsn } from './sentry.shared';

if (webDsn) {
  Sentry.init({
    ...sentryOptions(webDsn),
    // Le rejeu de session n'existe pas côté GlitchTip, et il enverrait le
    // contenu des écrans — dont les workflows d'un client — à un tiers.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}
