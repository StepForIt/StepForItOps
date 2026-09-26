import { PrismaClient } from '@prisma/client';

/**
 * La base des tests. Une VRAIE base postgres, et non un faux Prisma : ce qu'on
 * vient vérifier dans ces services est justement ce qu'ils écrivent — un upsert
 * sur une clé composée, un `updateMany` qui ne réestampille pas ce qui l'est
 * déjà. Un faux ORM rendrait ce que le test lui a soufflé.
 *
 * Elle est JETABLE et séparée de la base de dev : les tests vident les tables
 * entre deux cas. D'où le garde-fou sur le nom — un `DATABASE_URL_TEST` pointé
 * par distraction sur la base de dev effacerait le miroir de tout le parc.
 */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      'DATABASE_URL_TEST manquant. Une base jetable est attendue, jamais celle de dev :\n' +
        '  docker run -d --name nwm-test-pg -e POSTGRES_USER=nwm -e POSTGRES_PASSWORD=nwm \\\n' +
        '    -e POSTGRES_DB=nwm_test -p 55444:5432 postgres:16-alpine\n' +
        '  export DATABASE_URL_TEST=postgresql://nwm:nwm@localhost:55444/nwm_test',
    );
  }
  const name = url.split('/').pop()?.split('?')[0] ?? '';
  if (!name.endsWith('_test')) {
    throw new Error(
      `La base de test doit s'appeler « …_test » (reçu « ${name} ») : les tests VIDENT ses tables.`,
    );
  }
  return url;
}

let client: PrismaClient | null = null;

export function testPrisma(): PrismaClient {
  client ??= new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
  return client;
}

/**
 * Vide les tables touchées par les tests. `TRUNCATE … CASCADE` plutôt que des
 * `deleteMany` dans le bon ordre : l'ordre change à chaque relation ajoutée au
 * schéma, et un test qui échoue sur une clé étrangère ne parle pas de ce qu'il
 * teste.
 */
export async function resetDb(): Promise<void> {
  const prisma = testPrisma();
  // `CASCADE` emporte les tables qui référencent celles-ci (Finding, TestCase,
  // WorkflowVersion…). `ResourceMapping` et `PlatformSettings` ne référencent
  // rien, d'où leur mention (comme `NodePackageDoc`) : la seconde est un RÉGLAGE, et un test qui affiche
  // les archivés laisserait sinon la plateforme dans cet état pour les suivants.
  //
  // `ModuleState` est volontairement ABSENTE : le registre en garde un cache en
  // mémoire, que vider la table ne touche pas — la base dirait « activé par
  // défaut » et le cache « désactivé ». Un test qui désactive un module le
  // réactive donc lui-même, par la même route.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Workflow", "Instance", "ResourceMapping", "PlatformSettings", "ReleaseProcedure", "NodePackageDoc" RESTART IDENTITY CASCADE',
  );
}
