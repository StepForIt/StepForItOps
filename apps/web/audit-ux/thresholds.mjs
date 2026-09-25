/**
 * Les SEUILS : ce qui JUGE. Aucune sonde ici, aucun accès au navigateur — on
 * relit `measures.json` et on rend des constats.
 *
 * C'est l'autre moitié de la séparation annoncée dans `probes.mjs` : ajuster un
 * chiffre ci-dessous et rejouer `npm run audit:ux -- --report-only` suffit à
 * refaire le rapport, sans rouvrir un navigateur ni retoucher l'application.
 *
 * Chaque seuil porte la raison de son chiffre. Un seuil sans raison est un
 * seuil qu'on ne saura pas discuter dans deux ans.
 */
export const THRESHOLDS = {
  // Une page qui met plus de 3 s à devenir lisible est perçue comme cassée ;
  // 1,5 s est le confort. On mesure `domcontentloaded` → premier rendu utile.
  openMs: { warn: 1_500, bad: 3_000 },

  // Occupation de la surface visible. En dessous de 25 %, l'écran est vide à
  // l'œil : l'utilisateur scrolle pour trouver ce qui aurait tenu sans scroll.
  occupancy: { warn: 0.25, bad: 0.15 },

  // Une bande vide de plus du tiers de la hauteur visible est un trou : elle
  // pousse le contenu suivant hors de l'écran sans rien apporter.
  emptyBand: { warn: 0.33, bad: 0.5 },

  // Largeur utile : part de la place disponible (hors menu) qu'occupe le
  // contenu. Un conteneur étroit sur un écran large gâche la moitié du bureau —
  // sur une console de gestion, la densité est une fonctionnalité.
  usableWidth: { warn: 0.9 },

  // Un formulaire de plus de 12 champs visibles d'un coup ne se remplit pas,
  // il se subit : au-delà, on attend une hiérarchie essentiel / avancé.
  formFields: { warn: 8, bad: 12 },

  // Un champ sans nom associé n'est ni lisible au lecteur d'écran, ni
  // cliquable par son libellé. On n'en tolère aucun.
  unnamedFields: { bad: 1 },

  // Cibles tactiles : WCAG 2.5.5 (AAA) demande 44 px, 2.5.8 (AA) 24 px. On
  // compte les cibles sous 44 px et on ne crie qu'en MOBILE, où le doigt est
  // le seul pointeur — à la souris, 24 px suffisent et l'antd les respecte.
  smallTargetsMobile: { warn: 10, bad: 25 },

  // Un bouton-icône sans nom accessible est muet : au lecteur d'écran, il
  // s'annonce « bouton », et rien d'autre.
  iconOnlyUnnamed: { warn: 1, bad: 4 },

  // Débordement horizontal : sous 768 px, un seul pixel de scroll latéral
  // suffit à casser la lecture au pouce.
  overflowMobile: { bad: 1 },

  // axe : on remonte tout ce qui est `serious` ou `critical`, et on compte les
  // `moderate` sans en faire un constat à part — ils vivent dans le détail.
  axeImpacts: ['critical', 'serious'],

  // Erreurs console et requêtes en échec : une seule suffit à faire un constat.
  // Un 401 sur un écran ouvert sans session n'en est pas une, il est attendu.
  consoleErrors: { bad: 1 },
  failedRequests: { bad: 1 },
};

/**
 * Ce qu'il y a à FAIRE pour chaque règle axe rencontrée. « Corriger la règle
 * WCAG signalée » n'est pas une recommandation, c'est la reformulation du
 * constat : la personne qui lit sait déjà qu'il faut corriger, elle vient
 * chercher par quel bout.
 *
 * Les règles absentes de cette table gardent la description d'axe, qui est déjà
 * plus précise que rien.
 */
export const AXE_FIXES = {
  'aria-required-children':
    'Le menu (role=menu) contient des <div> qui ne sont pas des menuitem : sortir ces encarts du <Menu> ou leur donner le rôle attendu',
  'button-name': 'Poser un aria-label sur chaque Switch et bouton sans texte',
  label: "Associer un libellé aux Select (aria-label), qu'antd ne nomme pas tout seul",
  'color-contrast': 'Remonter le contraste des textes secondaires au-dessus de 4,5:1',
  'nested-interactive': "Un contrôle cliquable en contient un autre : n'en garder qu'un",
  'scrollable-region-focusable': 'Rendre la zone défilante atteignable au clavier (tabindex="0")',
  'aria-allowed-attr': "Retirer l'attribut ARIA que le rôle de cet élément n'admet pas",
};

/** Sévérité d'un constat, dans le vocabulaire du rapport. */
export const SEVERITY = { BLOCKING: 'Bloquant', MAJOR: 'Majeur', MINOR: 'Mineur' };

const RANK = { Bloquant: 0, Majeur: 1, Mineur: 2 };
const EFFORT_RANK = { S: 0, M: 1, L: 2 };

/**
 * Transforme les mesures d'un écran en constats. Un constat porte toujours sa
 * PREUVE — la mesure elle-même, chiffrée — parce qu'un audit qu'on ne peut pas
 * contredire n'est pas un audit, c'est un avis.
 */
/**
 * L'écran s'est-il chargé pour de vrai ?
 *
 * Quand un morceau du build manque (`/_next/…` coupé par un serveur de
 * développement qui redémarre), la page s'affiche mais React ne s'hydrate pas :
 * la mise en page n'est pas posée, axe ne voit presque rien, et la densité
 * mesurée ne décrit plus l'écran. Ces mesures-là ne doivent rien juger — un
 * faux constat coûte plus cher qu'un constat absent.
 */
export function isDegraded(m) {
  return (m.network?.failed ?? []).some(
    (f) => String(f.status).includes('ERR_EMPTY_RESPONSE') && f.url.startsWith('/_next/'),
  );
}

export function judgeScreen(screen, viewport, m, { devServer = false } = {}) {
  const out = [];
  // Un écran qui n'a pas fini de se charger ne se juge pas ; le rapport le
  // signale dans le tableau des mesures pour qu'on sache qu'il manque.
  if (isDegraded(m)) return out;
  /**
   * `key` est la FAMILLE du constat, la même d'un écran à l'autre. Sans elle, un
   * défaut systémique — le menu latéral, présent sur tous les écrans — sortait
   * une ligne par écran et par largeur : quatre cents lignes dont vingt-neuf
   * disaient la même chose, et un tableau qu'on ne lit pas ne priorise rien.
   * Le rapport les replie en une ligne qui dit « sur N écrans ».
   */
  const add = (key, severity, finding, proof, reco, effort) =>
    out.push({
      key,
      severity,
      screen: `${screen.label} (${viewport})`,
      screenLabel: screen.label,
      screenId: screen.id,
      viewport,
      finding,
      proof,
      reco,
      effort,
      origin: 'NOUVEAU',
    });

  // Le temps d'ouverture n'est JUGÉ que contre un build de production. Sur
  // `next dev`, ce qu'on mesure est la recompilation d'une route, pas l'écran :
  // le même écran passe de 3 s à 39 s selon ce que le compilateur a en cache et
  // la mémoire qui lui reste. Le chiffre reste RENDU dans le tableau de mesures
  // — il dit quelque chose du confort de développement —, il ne produit pas de
  // constat qu'on demanderait de corriger.
  if (m.openMs != null && !devServer) {
    if (m.openMs >= THRESHOLDS.openMs.bad)
      add(
        'open-slow',
        SEVERITY.MAJOR,
        `L'écran met ${(m.openMs / 1000).toFixed(1)} s à devenir lisible`,
        `mesure : ${m.openMs} ms (seuil ${THRESHOLDS.openMs.bad} ms)`,
        'Servir un squelette immédiat et charger les données en arrière-plan',
        'M',
      );
    else if (m.openMs >= THRESHOLDS.openMs.warn)
      add(
        'open-warn',
        SEVERITY.MINOR,
        `Ouverture lente (${(m.openMs / 1000).toFixed(1)} s)`,
        `mesure : ${m.openMs} ms (confort ${THRESHOLDS.openMs.warn} ms)`,
        "Vérifier le nombre d'appels au montage de l'écran",
        'M',
      );
  }

  if (m.console?.errors?.length >= THRESHOLDS.consoleErrors.bad)
    add(
      'console-errors',
      SEVERITY.MAJOR,
      `${m.console.errors.length} erreur(s) console à l'ouverture`,
      `1re : ${String(m.console.errors[0]).slice(0, 160)}`,
      "Corriger l'erreur : elle masque les vraies pannes dans la console",
      'M',
    );

  // Un serveur de développement qui se redémarre sous le parcours coupe les
  // requêtes en cours : le navigateur voit des `ERR_EMPTY_RESPONSE` sur les
  // fichiers de build. C'est une panne de l'ENVIRONNEMENT, pas de l'écran, et
  // en faire un constat enverrait l'équipe corriger un appel qui fonctionne.
  const failed = (m.network?.failed ?? []).filter(
    (f) => !(String(f.status).includes('ERR_EMPTY_RESPONSE') && f.url.startsWith('/_next/')),
  );
  if (failed.length >= THRESHOLDS.failedRequests.bad)
    add(
      'failed-requests',
      SEVERITY.MAJOR,
      `${failed.length} requête(s) en échec à l'ouverture`,
      failed
        .slice(0, 2)
        .map((f) => `${f.status} ${f.url}`)
        .join(' · '),
      'Traiter ou masquer ces appels : un écran qui échoue en silence ment',
      'M',
    );

  if (m.density) {
    const d = m.density;
    if (d.occupancy <= THRESHOLDS.occupancy.bad)
      add(
        'density-empty',
        SEVERITY.MAJOR,
        `Écran quasi vide : ${(d.occupancy * 100).toFixed(0)} % de la surface visible porte du contenu`,
        `occupation ${(d.occupancy * 100).toFixed(0)} % (seuil ${THRESHOLDS.occupancy.bad * 100} %)`,
        'Densifier : remonter le contenu, réduire les marges du conteneur',
        'M',
      );
    else if (d.occupancy <= THRESHOLDS.occupancy.warn)
      add(
        'density-low',
        SEVERITY.MINOR,
        `Densité faible (${(d.occupancy * 100).toFixed(0)} % de surface utile)`,
        `occupation ${(d.occupancy * 100).toFixed(0)} %`,
        'Resserrer les espacements de la zone de contenu',
        'S',
      );

    if (d.largestEmptyBand >= THRESHOLDS.emptyBand.bad)
      add(
        'empty-band',
        SEVERITY.MINOR,
        `Bande vide de ${(d.largestEmptyBand * 100).toFixed(0)} % de la hauteur visible`,
        `plus grande bande vide : ${(d.largestEmptyBand * 100).toFixed(0)} %`,
        'Supprimer la marge morte : elle repousse le contenu hors écran',
        'S',
      );

    if (viewport === 'mobile' && d.horizontalOverflow >= THRESHOLDS.overflowMobile.bad)
      add(
        'overflow-mobile',
        SEVERITY.MAJOR,
        `Débordement horizontal de ${d.horizontalOverflow} px en mobile`,
        `scrollWidth − innerWidth = ${d.horizontalOverflow} px à 390 px`,
        'Rendre le tableau défilable dans son conteneur plutôt que la page',
        'M',
      );

    if (viewport === 'desktop' && d.usableWidthRatio < THRESHOLDS.usableWidth.warn)
      add(
        'usable-width',
        SEVERITY.MINOR,
        `Le contenu n'occupe que ${(d.usableWidthRatio * 100).toFixed(0)} % de la largeur disponible`,
        `contenu ${d.contentWidth} px sur ${d.viewportWidth - d.siderWidth} px utiles`,
        'Élargir le conteneur : une console de gestion se lit en largeur',
        'S',
      );
  }

  if (m.form && screen.kind === 'form') {
    const f = m.form;
    if (f.fields >= THRESHOLDS.formFields.bad && f.collapsed === 0)
      add(
        'form-too-many',
        SEVERITY.MAJOR,
        `${f.fields} champs affichés d'un bloc, sans section « avancé »`,
        `champs visibles : ${f.fields}, repliés : ${f.collapsed}`,
        "Replier l'accessoire derrière un « Options avancées »",
        'M',
      );
    else if (f.fields >= THRESHOLDS.formFields.warn && f.collapsed === 0)
      add(
        'form-many',
        SEVERITY.MINOR,
        `${f.fields} champs sans hiérarchie essentiel / avancé`,
        `champs visibles : ${f.fields}`,
        'Regrouper les champs secondaires',
        'S',
      );

    const unnamed = f.fields - f.named;
    if (unnamed >= THRESHOLDS.unnamedFields.bad)
      add(
        'form-unnamed',
        SEVERITY.MAJOR,
        `${unnamed} champ(s) sans libellé associé`,
        `${f.named}/${f.fields} champs nommés`,
        'Associer un <label for> ou un aria-label à chaque champ',
        'S',
      );

    if (f.fields > 0 && f.requiredMarked === 0)
      add(
        'form-no-required',
        SEVERITY.MAJOR,
        'Aucun champ obligatoire signalé',
        `${f.fields} champs, 0 marqué obligatoire`,
        'Marquer les champs requis (`required` sur la Form.Item)',
        'S',
      );

    if (f.fields > 0 && !f.hasCancel)
      add(
        'form-no-exit',
        SEVERITY.MINOR,
        'Pas de sortie explicite du formulaire (ni « Annuler » ni « Retour »)',
        'aucun bouton « Annuler » / « Retour » trouvé',
        'Ajouter une sortie à côté du bouton principal',
        'S',
      );
  }

  if (m.states && (screen.kind === 'list' || screen.kind === 'dashboard')) {
    const s = m.states;
    if (s.empty > 0 && s.emptyWithAction === 0)
      add(
        'empty-no-action',
        SEVERITY.MINOR,
        'État vide sans action proposée',
        `${s.empty} bloc(s) vide(s), 0 avec bouton`,
        "Proposer l'action suivante dans l'état vide",
        'S',
      );

    if (s.tables > 0 && s.rows > 0 && s.sortableColumns === 0)
      add(
        'table-no-sort',
        SEVERITY.MINOR,
        'Tableau sans colonne triable',
        `${s.rows} lignes, 0 colonne triable`,
        'Rendre triables les colonnes de date et de nom',
        'S',
      );

    if (s.spinners > 0 && s.skeletons === 0)
      add(
        'spinner-not-skeleton',
        SEVERITY.MINOR,
        'Chargement rendu par un spinner nu plutôt qu’un squelette',
        `${s.spinners} spinner(s), 0 squelette`,
        'Remplacer par un Skeleton à la forme du contenu attendu',
        'M',
      );
  }

  if (m.a11y) {
    const a = m.a11y;
    if (a.iconOnlyUnnamed >= THRESHOLDS.iconOnlyUnnamed.bad)
      add(
        'icon-unnamed',
        SEVERITY.MAJOR,
        `${a.iconOnlyUnnamed} boutons-icône sans nom accessible`,
        `exemples : ${(a.iconOnlyUnnamedSample ?? []).slice(0, 3).join(' · ') || 'n/a'}`,
        'Poser un aria-label sur chaque bouton sans texte',
        'S',
      );
    else if (a.iconOnlyUnnamed >= THRESHOLDS.iconOnlyUnnamed.warn)
      add(
        'icon-unnamed',
        SEVERITY.MINOR,
        `${a.iconOnlyUnnamed} bouton(s)-icône sans nom accessible`,
        `exemples : ${(a.iconOnlyUnnamedSample ?? []).slice(0, 3).join(' · ') || 'n/a'}`,
        'Poser un aria-label',
        'S',
      );

    if (a.h1 === 0)
      add(
        'no-h1',
        SEVERITY.MINOR,
        "Aucun <h1> : l'écran ne se nomme pas dans sa structure",
        `titre du document : « ${a.title} »`,
        'Poser un titre de niveau 1 par écran',
        'S',
      );

    if (viewport === 'mobile' && a.smallTargets >= THRESHOLDS.smallTargetsMobile.bad)
      add(
        'small-targets',
        SEVERITY.MAJOR,
        `${a.smallTargets} cibles cliquables sous 44 px en mobile`,
        `${a.smallTargets}/${a.clickables} cibles`,
        'Agrandir les cibles des actions de ligne en mobile',
        'M',
      );
    else if (viewport === 'mobile' && a.smallTargets >= THRESHOLDS.smallTargetsMobile.warn)
      add(
        'small-targets',
        SEVERITY.MINOR,
        `${a.smallTargets} cibles sous 44 px en mobile`,
        `${a.smallTargets}/${a.clickables} cibles`,
        'Agrandir les cibles les plus utilisées',
        'M',
      );
  }

  if (m.axe?.violations?.length) {
    const serious = m.axe.violations.filter((v) => THRESHOLDS.axeImpacts.includes(v.impact));
    for (const v of serious)
      add(
        `axe:${v.id}`,
        v.impact === 'critical' ? SEVERITY.MAJOR : SEVERITY.MINOR,
        `axe ${v.id} — ${v.help}`,
        `${v.nodes} occurrence(s), ex. ${v.sample ?? 'n/a'}`,
        AXE_FIXES[v.id] ?? v.help,
        'S',
      );
  }

  return out;
}

/** Constats de FLUX : ils portent sur le parcours, pas sur un écran isolé. */
export function judgeFlow(flow) {
  const out = [];
  const add = (severity, finding, proof, reco, effort) =>
    out.push({
      severity,
      screen: 'Navigation',
      screenId: 'flow',
      finding,
      proof,
      reco,
      effort,
      origin: 'NOUVEAU',
    });

  if (flow.backRestores === false)
    add(
      'flow-back',
      SEVERITY.MAJOR,
      "Le bouton Précédent ne revient pas à l'écran précédent",
      `attendu ${flow.backFrom}, obtenu ${flow.backTo}`,
      "Faire porter la navigation par l'URL",
      'M',
    );

  for (const deep of flow.deepLinks ?? []) {
    if (!deep.ok)
      add(
        'flow-deep-link',
        SEVERITY.BLOCKING,
        `L'adresse profonde ${deep.path} ne se recharge pas`,
        `rechargement : ${deep.detail}`,
        'Rendre cette adresse autonome (elle est partagée en ticket)',
        'M',
      );
  }

  if (flow.globalSearch && !flow.globalSearch.opensWithShortcut && !flow.globalSearch.visibleField)
    add(
      'flow-search',
      SEVERITY.MAJOR,
      'Pas de recherche globale atteignable',
      'ni champ visible dans la nav, ni ⌘K',
      'Exposer la palette de commandes au clavier et dans la nav',
      'M',
    );

  return out;
}

/** Tri du rapport : sévérité d'abord, effort ensuite. */
export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort] ||
      a.screen.localeCompare(b.screen),
  );
}
