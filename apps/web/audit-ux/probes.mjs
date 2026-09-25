/**
 * Les SONDES : ce qui MESURE, dans la page. Elles ne jugent rien — aucune
 * constante de seuil ici, aucun mot comme « trop » ou « manquant ». Le verdict
 * est rendu par `thresholds.mjs`, à partir de ces nombres.
 *
 * La séparation a un prix (deux fichiers pour une idée) et une raison : on doit
 * pouvoir rediscuter un seuil sans reparcourir l'application, et reparcourir
 * l'application sans rediscuter les seuils. Les mesures brutes sont écrites
 * dans `measures.json` ; c'est ce fichier, et non l'application, que relit le
 * générateur de rapport.
 *
 * Tout est en LECTURE SEULE : on lit le DOM, on ne soumet rien, on ne clique
 * que sur des liens de navigation.
 */
import { AxeBuilder } from '@axe-core/playwright';

/**
 * Densité : quelle part de la surface visible porte du contenu, et quelle est
 * la plus grande bande horizontale vide.
 *
 * La méthode est un échantillonnage par points (`elementFromPoint`) et non un
 * calcul de boîtes : les boîtes se chevauchent, s'emboîtent et comptent
 * plusieurs fois la même surface, alors qu'un point ne répond qu'une chose —
 * l'élément qui est DESSUS, celui que l'œil voit.
 */
export async function measureDensity(page) {
  return page.evaluate(() => {
    const COLS = 48;
    const ROWS = 48;
    const w = window.innerWidth;
    const h = window.innerHeight;
    // Ce qui n'est pas du contenu : les conteneurs de mise en page. Un point qui
    // tombe dessus est un point vide — c'est du fond, pas de l'information.
    const LAYOUT = new Set(['HTML', 'BODY', 'MAIN', 'SECTION', 'ASIDE', 'HEADER', 'FOOTER']);
    const rows = [];
    let hits = 0;

    for (let r = 0; r < ROWS; r += 1) {
      const y = ((r + 0.5) / ROWS) * h;
      let rowHits = 0;
      for (let c = 0; c < COLS; c += 1) {
        const x = ((c + 0.5) / COLS) * w;
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        if (LAYOUT.has(el.tagName)) continue;
        // Un div de mise en page sans texte propre ni bordure ni fond ne compte pas.
        const style = getComputedStyle(el);
        const hasInk =
          (el.textContent ?? '').trim().length > 0 ||
          el.matches('svg, canvas, img, input, textarea, select, button, [role="img"]') ||
          style.borderTopWidth !== '0px' ||
          (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent');
        if (!hasInk) continue;
        rowHits += 1;
      }
      rows.push(rowHits);
      hits += rowHits;
    }

    // La plus grande bande vide, en part de la hauteur visible.
    let longest = 0;
    let current = 0;
    for (const rowHits of rows) {
      current = rowHits === 0 ? current + 1 : 0;
      if (current > longest) longest = current;
    }

    // La largeur utile : la boîte du contenu principal, hors menu latéral.
    const content =
      document.querySelector('.ant-layout-content') ?? document.querySelector('main') ?? document.body;
    const box = content.getBoundingClientRect();
    const sider = document.querySelector('.ant-layout-sider');
    const siderWidth = sider ? sider.getBoundingClientRect().width : 0;

    return {
      occupancy: Number((hits / (COLS * ROWS)).toFixed(3)),
      largestEmptyBand: Number((longest / ROWS).toFixed(3)),
      contentWidth: Math.round(box.width),
      viewportWidth: w,
      siderWidth: Math.round(siderWidth),
      usableWidthRatio: Number((box.width / Math.max(1, w - siderWidth)).toFixed(3)),
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - w),
    };
  });
}

/**
 * Formulaire : combien de champs, combien signalés obligatoires, combien portent
 * un nom lisible, combien sont repliés derrière un « avancé ».
 *
 * Aucun champ n'est rempli, aucun bouton n'est actionné : on compte ce qui est
 * là. Un formulaire d'édition ouvert et jamais soumis ne laisse rien derrière
 * lui, c'est la condition pour lancer l'audit sur un environnement peuplé.
 */
export async function measureForm(page) {
  return page.evaluate(() => {
    const FIELD = 'input:not([type="hidden"]), select, textarea, .ant-select-selector, .ant-switch';
    const all = Array.from(document.querySelectorAll(FIELD));
    const visible = all.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    });

    const named = visible.filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return true;
      const id = el.id;
      if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return true;
      if (el.closest('label')) return true;
      // antd pose le libellé dans `.ant-form-item-label` du même form-item.
      const item = el.closest('.ant-form-item');
      return Boolean(item?.querySelector('.ant-form-item-label label')?.textContent?.trim());
    });

    const requiredMarked = visible.filter((el) => {
      if (el.getAttribute('aria-required') === 'true' || el.hasAttribute('required')) return true;
      return Boolean(el.closest('.ant-form-item')?.querySelector('.ant-form-item-required'));
    });

    // Ce qui est replié : antd `Collapse`, `<details>`, ou un conteneur masqué.
    const collapsed = visible.filter((el) =>
      Boolean(
        el.closest('.ant-collapse-content-hidden') ||
        el.closest('details:not([open])') ||
        el.closest('[hidden]'),
      ),
    );

    const withHelp = visible.filter((el) =>
      Boolean(
        el.closest('.ant-form-item')?.querySelector('.ant-form-item-extra, .ant-form-item-explain') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('aria-describedby'),
      ),
    );

    const submits = Array.from(document.querySelectorAll('button[type="submit"], .ant-btn-primary')).length;
    const hasCancel = Boolean(
      Array.from(document.querySelectorAll('button, a')).find((el) =>
        /annuler|retour|cancel/i.test(el.textContent ?? ''),
      ),
    );

    return {
      fields: visible.length,
      fieldsTotal: all.length,
      named: named.length,
      requiredMarked: requiredMarked.length,
      collapsed: collapsed.length,
      withHelp: withHelp.length,
      submits,
      hasCancel,
    };
  });
}

/**
 * Les trois états d'un écran de données : vide, chargement, erreur. On note ce
 * qui EST rendu à l'instant de la mesure, plus ce que le DOM sait produire
 * (un squelette déclaré, une alerte d'erreur montée mais vide).
 */
export async function measureStates(page) {
  return page.evaluate(() => {
    const has = (sel) => document.querySelectorAll(sel).length;
    const emptyNodes = Array.from(document.querySelectorAll('.ant-empty, .ant-result'));
    // Un état vide utile PROPOSE l'action suivante : un bouton dedans, ou juste après.
    const emptyWithAction = emptyNodes.filter((el) =>
      Boolean(el.querySelector('button, a') || el.parentElement?.querySelector('button, a.ant-btn')),
    );
    return {
      empty: emptyNodes.length,
      emptyWithAction: emptyWithAction.length,
      spinners: has('.ant-spin-spinning'),
      skeletons: has('.ant-skeleton'),
      errorAlerts: has('.ant-alert-error, .ant-result-error'),
      tables: has('.ant-table'),
      rows: has('.ant-table-tbody > tr.ant-table-row'),
      pagination: has('.ant-pagination'),
      sortableColumns: has('.ant-table-column-has-sorters'),
      filterableColumns: has('.ant-table-filter-trigger'),
      localSearch: has('input[type="search"], input[placeholder*="echerch"], input[placeholder*="iltrer"]'),
    };
  });
}

/**
 * Accessibilité fine, là où axe ne dit rien : les cibles trop petites pour un
 * doigt, les boutons-icône sans nom, le focus initial d'un écran.
 */
export async function measureA11yExtras(page) {
  return page.evaluate(() => {
    const clickable = Array.from(
      document.querySelectorAll('button, a[href], [role="button"], .ant-btn, input[type="checkbox"]'),
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      // Une icône que le composant garde montée mais masquée (la croix d'effacement
      // d'un champ antd, par exemple) n'est pas une cible : la compter ferait un
      // constat sur un élément que personne ne voit ni n'atteint au clavier.
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0)
        return false;
      return el.closest('[aria-hidden="true"]') === null;
    });

    const small = clickable.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width < 44 || r.height < 44;
    });

    const iconOnlyUnnamed = clickable.filter((el) => {
      const text = (el.textContent ?? '').trim();
      if (text.length > 0) return false;
      return !(
        el.getAttribute('aria-label') ||
        el.getAttribute('title') ||
        el.getAttribute('aria-labelledby')
      );
    });

    return {
      clickables: clickable.length,
      smallTargets: small.length,
      iconOnlyUnnamed: iconOnlyUnnamed.length,
      iconOnlyUnnamedSample: iconOnlyUnnamed.slice(0, 5).map((el) => el.className || el.tagName),
      focusOnBody: document.activeElement === document.body,
      h1: document.querySelectorAll('h1').length,
      h1Text: document.querySelector('h1')?.textContent?.trim()?.slice(0, 80) ?? null,
      firstHeading: document.querySelector('h1, h2, h3')?.textContent?.trim()?.slice(0, 80) ?? null,
      title: document.title,
      landmarkMain: document.querySelectorAll('main, [role="main"]').length,
    };
  });
}

/** axe-core, WCAG 2.0/2.1 niveaux A et AA. La lib fait le travail, on range. */
export async function measureAxe(page) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return {
    violations: result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      sample: v.nodes[0]?.target?.join(' ') ?? null,
    })),
    total: result.violations.reduce((n, v) => n + v.nodes.length, 0),
  };
}

/** La recherche globale : un champ visible, ou le raccourci ⌘K / Ctrl-K. */
export async function measureGlobalSearch(page) {
  const beforeUrl = page.url();

  // TOUT se mesure après l'hydratation, et pas seulement l'appui sur la touche :
  // le raccourci est posé par un `useEffect`, et le libellé du raccourci n'est
  // écrit qu'une fois la plateforme du visiteur connue (le rendu serveur ne la
  // connaît pas). Lire le DOM avant, c'est conclure à l'absence d'une recherche
  // qui existe — et c'est exactement ce que cette sonde a d'abord fait.
  //
  // Le marqueur d'hydratation est donc ce libellé lui-même : il n'apparaît que
  // lorsque l'effet a tourné, c'est-à-dire lorsque le raccourci est branché. À
  // défaut, on attend le menu et on laisse un délai — une console sans libellé
  // de raccourci est un cas que la sonde doit savoir mesurer, pas supposer.
  const dialog = page.locator('.ant-modal-wrap:visible, [role="dialog"]:visible').first();
  let opensWithShortcut = false;
  let dom = { visibleField: 0, hintedTrigger: false };
  try {
    await page.locator('.ant-layout-sider').first().waitFor({ state: 'visible', timeout: 10_000 });
    const hydrated = await page
      .getByText(/⌘K|Ctrl\s*\+?\s*K/)
      .first()
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!hydrated) await page.waitForTimeout(3_000);
    dom = await page.evaluate(() => ({
      visibleField: document.querySelectorAll('header input[type="search"], nav input[type="search"]').length,
      hintedTrigger: Array.from(document.querySelectorAll('button, a, li, div')).some((el) =>
        /⌘K|Ctrl\s*\+?\s*K/i.test(el.textContent ?? ''),
      ),
    }));
    // On l'OUVRE pour vérifier qu'elle répond, et on la referme. Rien n'est saisi.
    // Les deux combinaisons sont essayées — ⌘K sur Mac, Ctrl-K ailleurs.
    //
    // Aucun clic pour « poser le focus » au préalable : le raccourci est écouté
    // sur `window`, le document a déjà le focus après la navigation, et un clic
    // à l'aveugle tombe sur ce qui se trouve à ces coordonnées — le titre du
    // menu, qui est un lien. La sonde changeait alors de page avant d'appuyer,
    // et concluait à l'absence du raccourci.
    for (const combo of ['Meta+k', 'Control+k']) {
      await page.keyboard.press(combo);
      // `isVisible()` répond TOUT DE SUITE : il faut attendre, la modale
      // s'ouvre avec une animation.
      opensWithShortcut = await dialog
        .waitFor({ state: 'visible', timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (opensWithShortcut) {
        await page.keyboard.press('Escape');
        break;
      }
    }
  } catch {
    opensWithShortcut = false;
  }
  // On ne doit pas avoir changé d'ÉCRAN. La comparaison porte sur le chemin et
  // non sur l'URL entière : Refine repousse les paramètres de liste dans la
  // query après le rendu, et une recherche qui ne navigue nulle part verrait
  // quand même son URL bouger.
  const samePath = new URL(page.url()).pathname === new URL(beforeUrl).pathname;
  return { ...dom, opensWithShortcut, urlStable: samePath };
}
