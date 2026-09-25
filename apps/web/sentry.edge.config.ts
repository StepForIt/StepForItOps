// Runtime edge : c'est là que tourne le middleware d'authentification.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions, webDsn } from './sentry.shared';

if (webDsn) Sentry.init(sentryOptions(webDsn));
