import { execFileSync } from 'node:child_process';
import { testDatabaseUrl } from './helpers/db';

/**
 * Pose le schéma dans la base de test, une fois par exécution.
 *
 * `db push` et non `migrate deploy` : ce qu'on veut ici est la FORME de la base
 * la plus proche de `schema.prisma`, tout de suite. Que les migrations
 * produisent bien ce schéma est une autre question, et elle a son propre job de
 * CI (`migrate.sh` + `prisma:check`) — la poser deux fois ferait payer aux
 * tests une vérification qui ne les concerne pas.
 */
export default function setup(): void {
  execFileSync('./node_modules/.bin/prisma', ['db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'inherit',
  });
}
