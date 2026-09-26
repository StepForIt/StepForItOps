import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import {
  AI_PORT,
  DOCS_PORT,
  PACKAGE_DOCS_PORT,
  MONITOR_ADMIN_PORT,
  MONITOR_PORT,
  N8N_API_PORT,
  NODE_CATALOG_PORT,
  NOTIFICATION_PORT,
  STORAGE_PORT,
  VCS_PORT,
} from '@nwm/core';
import { testDatabaseUrl } from './db';

/**
 * L'application entière, démarrée pour de vrai et interrogée en HTTP.
 *
 * C'est le seul niveau où existent les choses que la plateforme promet À CHAQUE
 * route et qu'aucun test de service ne peut voir : le garde de jeton, celui des
 * modules désactivés, la traduction des erreurs Prisma en 400/404/409, la
 * pagination Refine et son `x-total-count`. Un service rend un objet ; ce qui
 * arrive au navigateur est décidé après lui.
 *
 * Tous les ports sortants sont remplacés, et par défaut par une doublure qui
 * ÉCHOUE : un test qui atteint le réseau sans l'avoir voulu doit le dire, avec
 * le nom du port et de la méthode. Un faux silencieux transformerait un appel
 * involontaire en test vert.
 */

/** Ce que Nest cherche sur un provider sans que personne ne l'ait écrit. */
const LIFECYCLE = new Set([
  'onModuleInit',
  'onModuleDestroy',
  'onApplicationBootstrap',
  'onApplicationShutdown',
  'beforeApplicationShutdown',
]);

/** Le port `name`, dont tout appel non prévu échoue en nommant ce qu'on a demandé. */
export function strictPort<T extends object>(name: string, provided: Partial<T> = {}): T {
  return new Proxy(provided, {
    get(target, property) {
      if (property in target) return target[property as keyof typeof target];
      // Nest teste si la valeur fournie est un thenable avant de l'injecter, et
      // appelle ses hooks de cycle de vie s'il les trouve : un piège qui
      // répondrait à TOUT ferait passer la doublure pour une promesse, puis
      // échouerait sur un `onModuleInit` que personne n'a écrit. Les symboles
      // sont lus par les outils d'inspection.
      if (typeof property === 'symbol' || property === 'then' || LIFECYCLE.has(property)) {
        return undefined;
      }
      return () => {
        throw new Error(
          `${name}.${String(property)}() appelé sans avoir été fourni par le test : ` +
            'ce chemin sort de la plateforme, il doit être explicite.',
        );
      };
    },
  }) as T;
}

export interface TestApp {
  app: INestApplication;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Doublures fournies par le test, par token de port. */
  ports?: Partial<
    Record<
      'n8n' | 'ai' | 'catalog' | 'monitor' | 'notify' | 'vcs' | 'storage' | 'docs' | 'packageDocs',
      object
    >
  >;
  /** Variables d'environnement posées avant le démarrage (jeton d'API, par ex.). */
  env?: Record<string, string | undefined>;
}

const TOKENS = {
  n8n: N8N_API_PORT,
  ai: AI_PORT,
  catalog: NODE_CATALOG_PORT,
  monitor: MONITOR_PORT,
  notify: NOTIFICATION_PORT,
  vcs: VCS_PORT,
  storage: STORAGE_PORT,
  docs: DOCS_PORT,
  packageDocs: PACKAGE_DOCS_PORT,
} as const;

export async function startTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  // Prisma lit DATABASE_URL à la construction : la base jetable doit être posée
  // avant que le conteneur n'instancie PrismaService.
  process.env.DATABASE_URL = testDatabaseUrl();
  const restore: Array<[string, string | undefined]> = [];
  for (const [key, value] of Object.entries(options.env ?? {})) {
    restore.push([key, process.env[key]]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  // Importé ici et non en tête : `buildAppModule` charge les modules métier, et
  // ce chargement doit voir l'environnement que le test vient de poser.
  const { buildAppModule } = await import('../../src/app.module');
  const { AllExceptionsFilter } = await import('../../src/common/filters/all-exceptions.filter');

  let builder = Test.createTestingModule({ imports: [await buildAppModule()] });
  for (const [key, token] of Object.entries(TOKENS)) {
    const provided = options.ports?.[key as keyof typeof TOKENS];
    builder = builder.overrideProvider(token).useValue(strictPort(key, provided ?? {}));
  }
  builder = builder.overrideProvider(MONITOR_ADMIN_PORT).useValue(strictPort('monitorAdmin'));

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  // Le filtre global fait partie de ce qu'on teste : sans lui, une erreur Prisma
  // traduite en 400 par le mapper repartirait en 500 dans ces tests seulement.
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  // Les crons démarrent avec l'application. Cinq d'entre eux tournent à la
  // minute : laissés en route, ils frapperaient les doublures strictes au milieu
  // d'un test, et l'échec parlerait d'un poll que personne n'a demandé.
  const scheduler = app.get(SchedulerRegistry);
  for (const job of scheduler.getCronJobs().values()) job.stop();

  return {
    app,
    async close() {
      await app.close();
      for (const [key, value] of restore) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
