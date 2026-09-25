// Serveur Next : rendu des pages, routes /auth/*, proxy /backend/*.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions, webDsn } from './sentry.shared';

if (webDsn) Sentry.init(sentryOptions(webDsn));
