import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Les tests de l'api, à deux niveaux.
 *
 * Les tests de SERVICE instancient leur cible à la main (`new
 * ProposalService(...)`) : l'hexagonal les rend joignables sans conteneur, les
 * collaborateurs étant des ports, donc des objets qu'on fournit.
 *
 * Les tests de BOUT EN BOUT, eux, démarrent l'application Nest entière et lui
 * parlent en HTTP : c'est le seul niveau où les gardes, les filtres d'exception
 * et les conventions de pagination existent — rien de tout cela n'est visible
 * depuis un service. Ils ont besoin de la DI, donc de `emitDecoratorMetadata`,
 * qu'esbuild ne sait pas produire : d'où SWC ci-dessous, qui transforme tout le
 * dossier de la même façon que `nest build`.
 */
export default defineConfig({
  plugins: [
    // `module: 'commonjs'` et non le défaut ESM : les décorateurs Nest et le
    // `reflect-metadata` du runtime supposent la même sémantique qu'au build.
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // `@Inject()` et `@Injectable()` écrivent des métadonnées au chargement des
    // classes : sans reflect-metadata, l'import du service échoue avant le test.
    setupFiles: ['test/setup.ts'],
    // Le schéma est posé une fois dans la base jetable (cf. test/helpers/db.ts).
    globalSetup: ['test/global-setup.ts'],
    // Les suites qui touchent la base vident les mêmes tables : les paralléliser
    // les ferait s'effacer l'une l'autre. Le coût est nul à cette taille.
    fileParallelism: false,
  },
});
