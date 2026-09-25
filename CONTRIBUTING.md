# Contribuer

Les contributions sont bienvenues : issues, correctifs, nouveaux modules.

## Avant d'ouvrir une PR

- Une PR = un sujet. Les gros changements se discutent d'abord dans une issue.
- Les règles d'architecture de [CLAUDE.md](CLAUDE.md) sont contraignantes : domaine sans framework, un fichier une responsabilité, modules autonomes, communication inter-modules par événements uniquement.
- Toute modification de `apps/api/prisma/schema.prisma` part **avec sa migration**.
- `pnpm format:check`, `pnpm lint`, `pnpm test`, `pnpm typecheck` et `pnpm build` passent — la CI (`.github/workflows/ci.yml`) les rejoue sur chaque PR, après un `prisma generate`.
- Les tests de `apps/api` demandent une base jetable (`DATABASE_URL_TEST`, cf. [CLAUDE.md](CLAUDE.md)) : ils écrivent pour de vrai, et refusent toute base dont le nom ne finit pas par `_test`.
- Les parcours Playwright (`pnpm --filter @nwm/web test:e2e`) ne sont pas dans `pnpm test` : ils démarrent l'api et la console. La CI les joue dans son propre job.
- Docs en français, code et identifiants en anglais.

## Licence des contributions (à lire)

Le projet est distribué sous [Business Source License 1.1](LICENSE.md) et bascule en AGPL-3.0 à la Change Date. Pour que cela reste tenable, en proposant une contribution vous déclarez :

1. **en être l'auteur**, ou avoir le droit de la soumettre (elle n'appartient pas à un employeur ou à un client qui n'a pas donné son accord) ;
2. la licencier sous les termes du projet ;
3. **accorder à Step For It — Mathieu Monin le droit non exclusif, irrévocable et gratuit de la redistribuer sous d'autres termes**, y compris sous une licence commerciale ou sous une future licence du projet.

Le point 3 n'est pas une formalité : sans lui, plus aucun changement de licence n'est possible une fois la première contribution fusionnée, et aucune licence commerciale ne peut couvrir le code contribué. C'est irréversible, d'où la demande en amont.

Vous conservez le droit d'auteur sur vos contributions ; rien ne vous est cédé, seul un droit d'usage large est accordé.

Mentionnez dans la PR : `Je contribue sous les termes de CONTRIBUTING.md.`

## Ce qui reste hors licence

Le nom « StepForIt Ops » et le logo ne sont couverts ni par la licence, ni par le présent document.
