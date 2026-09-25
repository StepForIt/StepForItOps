/**
 * tsc ne réécrit pas les alias de paths (@nwm/*) dans le JS compilé.
 * Ce fichier — importé EN PREMIER par main.ts — mappe les alias vers les
 * packages compilés dans dist/packages/*. Indispensable au runtime (node dist/...).
 *
 * Les adapters sont découverts : chaque dossier de dist/packages/adapters devient
 * `@nwm/adapter-<dossier>` (même convention que le wildcard `paths` du tsconfig,
 * qui impose dossier = suffixe de l'alias). Un nouvel adapter n'a donc rien à
 * déclarer ici — sans quoi Node retomberait sur le symlink pnpm, qui pointe vers
 * la SOURCE TypeScript (`main: src/index.ts`) : crash au boot, pas à la compile.
 */
import * as fs from 'fs';
import * as path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const moduleAlias = require('module-alias');

const packagesRoot = path.resolve(__dirname, '../../../packages');

moduleAlias.addAlias('@nwm/core', path.join(packagesRoot, 'core/src'));

const adaptersRoot = path.join(packagesRoot, 'adapters');
for (const dir of fs.readdirSync(adaptersRoot)) {
  const src = path.join(adaptersRoot, dir, 'src');
  if (fs.existsSync(src)) moduleAlias.addAlias(`@nwm/adapter-${dir}`, src);
}
