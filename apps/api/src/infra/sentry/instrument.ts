// Importé au tout début de `main.ts` : le SDK doit s'installer avant les modules
// qu'il instrumente (http, express), et surtout avant `loadFeatureModules` —
// sinon un module qui casse au chargement ne remonte nulle part.
import { initSentry } from './sentry';

initSentry();
