/**
 * Le rapport : `docs/audit-ux/AAAA-MM-JJ-<env>.md`.
 *
 * Il ne mesure rien et ne parcourt rien — il relit `measures.json` et applique
 * `thresholds.mjs`. D'où `--report-only` : rediscuter un seuil ne coûte pas un
 * parcours.
 *
 * Les constats issus du CODE (revue experte, hors parcours) vivent dans
 * `findings-code.json` à côté du runner : ce que le navigateur ne voit pas —
 * une confirmation native, un effet de bord non dit, une incohérence entre deux
 * écrans — ne se mesure pas, il se lit. Les deux sources sont fusionnées ici,
 * dans un seul tableau trié, parce qu'une équipe priorise une liste et non deux.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCREENS } from './screens.mjs';
import { judgeScreen, judgeFlow, sortFindings, isDegraded } from './thresholds.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const escape = (value) =>
  String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');

/** Les constats de la revue de code, s'il y en a. Format : cf. findings-code.json. */
function loadCodeFindings() {
  const path = join(HERE, 'findings-code.json');
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Replie les constats d'une même FAMILLE en une ligne.
 *
 * Un défaut du menu latéral se mesure sur les vingt-neuf écrans et les deux
 * largeurs : sans repliage, le tableau sortait quatre cents lignes dont la
 * moitié disaient la même chose, et une équipe ne priorise pas quatre cents
 * lignes — elle les ferme. La ligne repliée garde ce qui se corrige (le constat,
 * la reco) et dit l'AMPLEUR : sur combien d'écrans, et lequel est le pire.
 *
 * Un constat qui n'apparaît que sur un écran garde son nom d'écran : replier ce
 * qui ne se répète pas ne ferait que perdre l'information.
 */
function collapse(findings) {
  const families = new Map();
  for (const f of findings) {
    const key = `${f.key ?? f.finding}|${f.severity}`;
    const family = families.get(key) ?? { ...f, screens: new Set(), worst: f };
    family.screens.add(f.screenLabel ?? f.screen);
    // Le pire cas est celui dont la preuve porte le plus grand nombre : c'est lui
    // qu'on va regarder en premier, et son écran mérite d'être nommé.
    const size = (s) => Number((String(s).match(/\d+/) ?? [0])[0]);
    if (size(f.proof) > size(family.worst.proof)) family.worst = f;
    families.set(key, family);
  }

  return [...families.values()].map((family) => {
    const count = family.screens.size;
    if (count === 1) return { ...family, screen: family.worst.screen };
    return {
      ...family,
      screen: `${count} écrans`,
      // « 28 boutons sans nom » devient « jusqu'à 28 » : le chiffre est celui du
      // pire écran, pas un total, et le donner nu ferait croire à une somme.
      finding: /^\d/.test(family.worst.finding) ? `Jusqu’à ${family.worst.finding}` : family.worst.finding,
      proof: `${family.worst.proof} — pire cas : ${family.worst.screen}`,
    };
  });
}

export function writeReport(measures, repoRoot) {
  const byId = new Map(SCREENS.map((s) => [s.id, s]));
  const measured = [];

  for (const result of measures.screens ?? []) {
    const screen = byId.get(result.screen);
    if (!screen || !result.reached) continue;
    measured.push(
      ...judgeScreen(screen, result.viewport, result, { devServer: measures.devServer === true }),
    );
  }
  if (measures.flow) measured.push(...judgeFlow(measures.flow));

  const all = sortFindings([...collapse(measured), ...loadCodeFindings()]);
  const unreached = (measures.screens ?? []).filter((r) => !r.reached && r.viewport === 'desktop');
  const reachedDesktop = (measures.screens ?? []).filter((r) => r.reached && r.viewport === 'desktop');

  const date = (measures.startedAt ?? new Date().toISOString()).slice(0, 10);
  const blocking = all.filter((f) => f.severity === 'Bloquant').length;
  const major = all.filter((f) => f.severity === 'Majeur').length;
  const minor = all.filter((f) => f.severity === 'Mineur').length;
  const slowest = [...reachedDesktop].sort((a, b) => b.openMs - a.openMs)[0];
  const axeTotal = reachedDesktop.filter((r) => !isDegraded(r)).reduce((n, r) => n + (r.axe?.total ?? 0), 0);
  const degraded = (measures.screens ?? []).filter((r) => r.reached && isDegraded(r));

  const lines = [];
  lines.push(`# Audit UI/UX — StepForIt Ops · ${measures.env} · ${date}`);
  lines.push('');
  lines.push(
    `Cible ${measures.baseUrl} · session ${measures.session} · ` +
      `${reachedDesktop.length}/${SCREENS.length} écrans atteints · 1440 px et 390 px.`,
  );
  lines.push(
    `${blocking} bloquant · ${major} majeurs · ${minor} mineurs · ` +
      `${axeTotal} violations axe (WCAG 2 A/AA) sur les écrans atteints.`,
  );
  if (slowest && !measures.devServer)
    lines.push(`Écran le plus lent : ${slowest.screen} à ${slowest.openMs} ms.`);
  if (unreached.length)
    lines.push(`Non atteints : ${unreached.map((r) => `${r.screen} (${r.reason})`).join(' · ')}.`);
  if (degraded.length)
    lines.push(
      `${degraded.length} mesure(s) écartée(s) : le serveur de développement a coupé des fichiers du ` +
        `build pendant le chargement, la page ne s'est pas hydratée.`,
    );
  lines.push(
    `Aucune écriture émise pendant le parcours` +
      (measures.blockedWrites?.length ? ` — ${measures.blockedWrites.length} bloquée(s) par le garde.` : '.'),
  );
  lines.push('');

  lines.push('## Constats');
  lines.push('');
  lines.push('| # | Sévérité | Écran | Constat | Preuve | Reco | Effort |');
  lines.push('|---|---|---|---|---|---|---|');
  all.forEach((f, i) => {
    lines.push(
      `| ${i + 1} | ${f.severity} | ${escape(f.screen)} | [${f.origin ?? 'NOUVEAU'}] ${escape(f.finding)} | ` +
        `${escape(f.proof)} | ${escape(f.reco)} | ${f.effort} |`,
    );
  });
  lines.push('');

  // Un quick win doit pouvoir s'attraper : il porte un `fichier:ligne`. Les
  // constats mesurés qui n'en ont pas — une règle axe rendue par un sélecteur
  // CSS — sont vrais mais demandent d'abord de chercher où, ce qui n'est plus
  // un effort S. Ils restent dans le tableau.
  const locatable = /\.(tsx?|mjs):\d+/;
  const quickWins = all.filter((f) => f.effort === 'S' && locatable.test(f.proof)).slice(0, 5);
  lines.push('## Top 5 quick wins (effort S)');
  lines.push('');
  quickWins.forEach((f, i) => {
    lines.push(`${i + 1}. **${escape(f.finding)}** — ${escape(f.reco)}. ${escape(f.proof)}`);
  });
  if (!quickWins.length)
    lines.push('_Aucun constat à effort S dont la preuve donne un fichier et une ligne._');
  lines.push('');

  // Ce qui a été contrôlé et tenu. Un audit qui ne liste que ses reproches
  // laisse croire que le reste n'a pas été regardé, et la deuxième lecture
  // recommence le même travail.
  const ok = [];
  const gs = measures.flow?.globalSearch;
  if (gs?.opensWithShortcut)
    ok.push("la recherche globale répond au raccourci clavier et ne change pas d'écran");
  if (gs?.hintedTrigger) ok.push('le raccourci est ÉCRIT dans le menu, donc apprenable');
  if (measures.flow?.backRestores === true) ok.push("le bouton Précédent revient bien à l'écran précédent");
  if ((measures.blockedWrites ?? []).length === 0) ok.push('aucune écriture émise pendant le parcours');
  const noOverflow = (measures.screens ?? []).filter(
    (r) => r.reached && r.viewport === 'mobile' && r.density?.horizontalOverflow === 0,
  ).length;
  if (noOverflow) ok.push(`aucun débordement horizontal à 390 px sur ${noOverflow} écrans`);
  if (ok.length) {
    lines.push('## Vérifié et tenu');
    lines.push('');
    for (const item of ok) lines.push(`- ${item}`);
    lines.push('');
  }

  lines.push('## Mesures par écran (desktop)');
  if (measures.devServer)
    lines.push(
      '',
      "_Cible servie par `next dev` : la colonne « Ouverture » mesure la recompilation d'une route " +
        "autant que l'écran, elle n'est donc pas jugée. Pour un verdict de performance, viser un build " +
        'de production._',
    );
  lines.push('');
  lines.push('| Écran | Ouverture | Occupation | Bande vide | Largeur utile | axe A/AA | Erreurs console |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of reachedDesktop) {
    const d = r.density ?? {};
    if (isDegraded(r)) {
      lines.push(
        `| ${byId.get(r.screen)?.label ?? r.screen} | ${r.openMs} ms | — | — | — | — | — |` +
          ' <!-- chargement incomplet : non mesuré -->',
      );
      continue;
    }
    lines.push(
      `| ${byId.get(r.screen)?.label ?? r.screen} | ${r.openMs} ms | ` +
        `${d.occupancy != null ? `${(d.occupancy * 100).toFixed(0)} %` : '—'} | ` +
        `${d.largestEmptyBand != null ? `${(d.largestEmptyBand * 100).toFixed(0)} %` : '—'} | ` +
        `${d.usableWidthRatio != null ? `${(d.usableWidthRatio * 100).toFixed(0)} %` : '—'} | ` +
        `${r.axe?.total ?? '—'} | ${r.console?.errors?.length ?? 0} |`,
    );
  }
  lines.push('');
  if (unreached.length) {
    lines.push('## Écrans non atteints');
    lines.push('');
    for (const r of unreached) lines.push(`- **${byId.get(r.screen)?.label ?? r.screen}** — ${r.reason}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(
    `Rejouable tel quel : \`pnpm audit:ux -- --env=${measures.env}\` ` +
      `(outil : \`apps/web/audit-ux/\`, mesures brutes : \`apps/web/audit-ux/.out/${measures.env}/measures.json\`).`,
  );

  const dir = join(repoRoot, 'docs/audit-ux');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${date}-${measures.env}.md`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}
