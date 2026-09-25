import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

/**
 * Le lint du dépôt.
 *
 * Il ne juge PAS la mise en forme : c'est le travail de Prettier, et deux
 * outils qui se disputent l'indentation ne produisent qu'une file de conflits
 * (`eslint-config-prettier`, en dernier, éteint ces règles-là).
 *
 * Il ne fait pas non plus d'analyse typée : `tsc --noEmit` tourne déjà sur tout
 * le workspace, et les règles typées de typescript-eslint coûtent un projet
 * TypeScript par paquet pour redire ce que le typecheck a dit.
 *
 * Ce qu'il attrape, lui seul : une variable ou un import qui ne sert plus, une
 * promesse jamais attendue, un `any` glissé dans un dépôt qui n'en a aucun, un
 * hook React appelé sous condition.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-*/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // La convention du dépôt : pas de `any` hors frontière JSON n8n, où le
      // typage se fait au plus tôt (`N8nWorkflow`). Le dépôt n'en compte
      // aujourd'hui aucun — c'est le genre de zéro qui ne se garde pas tout seul.
      '@typescript-eslint/no-explicit-any': 'error',
      // Un argument non utilisé se nomme `_` quand il est là pour la position
      // (une signature de port, un paramètre de callback).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          // `const { tags, ...row } = x` est la façon idiomatique de RETIRER une
          // clé : la nommer est le geste, pas un oubli.
          ignoreRestSiblings: true,
        },
      ],
      // La sortie du conteneur n'est pas un journal : `Logger` de Nest passe par
      // le tampon de `app-logs`, que la console affiche. Les deux exceptions de
      // `main.ts` (avant que le logger n'existe) portent leur commentaire.
      'no-console': 'error',
    },
  },
  {
    // Le service worker : ni Node ni fenêtre, son propre jeu de globales.
    files: ['apps/web/public/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // Les fichiers de configuration en CommonJS (next.config.js) : `require`
    // y est la seule forme possible, Next les charge lui-même.
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Le web : React et le navigateur.
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Les tests : on y écrit des doublures partielles, castées vers le type du
    // port. Le typecheck les couvre déjà (`test/` est dans le tsconfig de l'api).
    files: ['**/test/**/*.ts', '**/e2e/**/*.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    // Scripts et configurations : Node pur, et une sortie console qui EST leur
    // interface — ils parlent à qui lance la commande.
    files: ['**/*.mjs', '**/*.config.{js,mjs,ts}', 'apps/*/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // L'audit UX : du Node qui pilote un navigateur, et dont les SONDES sont
    // du code exécuté DANS la page (`page.evaluate`). Les deux jeux de globales
    // cohabitent donc dans le même fichier — `document` y est aussi normal que
    // `process`, et le lint n'a aucun moyen de distinguer les deux moitiés.
    files: ['apps/web/audit-ux/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  prettier,
);
