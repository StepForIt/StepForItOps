'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useResource } from '@refinedev/core';
import { useTranslations } from 'next-intl';
import { formatDocumentTitle, resolveScreenLabel, type ScreenRoute } from '../lib/screen-title';

/**
 * Nomme l'écran courant : pose `document.title` (onglet, historique, favori) ET
 * l'unique `<h1>` de la console, en tête du contenu.
 *
 * Monté une fois dans la Console : un seul mécanisme pour les ~30 écrans, là où
 * chaque page aurait dû déclarer son titre à la main. Le `<h1>` est réservé aux
 * lecteurs d'écran (repère de page) : les listes Refine affichent déjà leur titre
 * à l'œil, un second titre visible le doublerait.
 */

/**
 * Routes qui ne sortent pas d'une resource Refine : la home et les pages de
 * détail, dont le libellé se veut au singulier (« Workflow », pas « Workflows »).
 */
const staticRoutes = (t: ReturnType<typeof useTranslations<'app.screen'>>): ScreenRoute[] => [
  { pattern: '/', label: t('home') },
  { pattern: '/workflows/show/:id', label: t('workflow') },
  { pattern: '/instances/show/:id', label: t('instance') },
];

/** Hors de l'écran mais lu : le motif « sr-only » classique. */
const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

const asPath = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * Les routes connues de la console, dérivées des resources Refine : le même
 * `meta.label` qui nomme l'entrée de menu nomme l'onglet et le `<h1>`. Les pages
 * `show` sont laissées aux libellés singuliers de `STATIC_ROUTES`.
 */
export function useScreenRoutes(): ScreenRoute[] {
  const { resources } = useResource();
  const t = useTranslations('app.screen');
  return React.useMemo(() => {
    const routes: ScreenRoute[] = staticRoutes(t);
    for (const resource of resources) {
      const label = (resource.meta?.label as string) ?? resource.name;
      const list = asPath(resource.list);
      const create = asPath(resource.create);
      const edit = asPath(resource.edit);
      if (list) routes.push({ pattern: list, label });
      if (create)
        routes.push({
          pattern: create,
          label: (resource.meta?.createLabel as string) ?? t('create', { label }),
        });
      if (edit) routes.push({ pattern: edit, label: t('edit', { label }) });
    }
    return routes;
  }, [resources, t]);
}

export function ScreenTitle() {
  const pathname = usePathname();
  const routes = useScreenRoutes();
  const label = React.useMemo(() => resolveScreenLabel(pathname, routes), [pathname, routes]);

  React.useEffect(() => {
    document.title = formatDocumentTitle(label);
  }, [label]);

  if (!label) return null;
  return <h1 style={VISUALLY_HIDDEN}>{label}</h1>;
}
