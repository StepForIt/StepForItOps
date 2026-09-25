'use client';

import React from 'react';
import { useMenu, useResource } from '@refinedev/core';
import { ApiOutlined, BulbOutlined, CompassOutlined, PlusOutlined } from '@ant-design/icons';
import { useInstanceScope } from '../lib/instance-scope';
import { matchesQuery } from '../lib/command-search';
import { TIPS } from '../app/aide/tip-catalog';

/** Une entrée de la barre de recherche : ce qu'on affiche, ce qu'on cherche, ce qu'on fait. */
export interface Command {
  key: string;
  label: string;
  /** Précision affichée en gris à droite (page parente, url de l'instance…). */
  detail?: string;
  icon: React.ReactNode;
  /** Mots supplémentaires pris en compte par la recherche, jamais affichés. */
  keywords?: string;
  route: string;
}

/**
 * La création d'un workflow n'a pas d'écran à elle : c'est une fenêtre de la
 * page Workflows, ouverte par ce paramètre. Le reste des créations sort des
 * resources Refine, qui portent une vraie route.
 */
const CREATE_WORKFLOW: Command = {
  key: 'create:workflow',
  label: 'Créer un workflow',
  icon: <PlusOutlined />,
  keywords: 'creer nouveau workflow vide assistant',
  route: '/workflows?create=1',
};

const TIP_COMMANDS: Command[] = TIPS.map((tip) => ({
  key: `tip:${tip.id}`,
  label: tip.title,
  detail: 'Astuce',
  icon: <BulbOutlined />,
  keywords: `aide astuce comment ${tip.text} ${tip.keywords ?? ''}`,
  route: `/aide?tip=${tip.id}`,
}));

/**
 * Pages, créations et instances : les entrées qui ne demandent aucun appel réseau.
 *
 * Elles sont déduites des resources Refine plutôt que listées à la main : une
 * resource masquée par un module désactivé disparaît du menu ET d'ici, sans
 * qu'une seconde liste ait à être tenue à jour.
 */
export function useStaticCommands(): Command[] {
  const { menuItems } = useMenu();
  const { resources } = useResource();
  const { instances } = useInstanceScope();

  return React.useMemo(() => {
    const pages: Command[] = [];
    const walk = (items: typeof menuItems, parent?: string) => {
      for (const item of items) {
        if (item.route) {
          pages.push({
            key: `page:${item.key ?? item.route}`,
            label: item.label ?? item.name,
            detail: parent,
            icon: item.icon ?? <CompassOutlined />,
            keywords: `aller ouvrir page ${parent ?? ''}`,
            route: item.route,
          });
        }
        if (item.children.length) walk(item.children, item.label ?? item.name);
      }
    };
    walk(menuItems);

    const creations: Command[] = resources
      .filter((resource) => typeof resource.create === 'string' && !resource.meta?.hide)
      .map((resource) => {
        const label = (resource.meta?.label as string) ?? resource.name;
        return {
          key: `create:${resource.name}`,
          label: (resource.meta?.createLabel as string) ?? `Créer — ${label}`,
          icon: <PlusOutlined />,
          keywords: `creer nouveau nouvelle ajouter ${label}`,
          route: resource.create as string,
        };
      });

    const instanceCommands: Command[] = instances.map((instance) => ({
      key: `instance:${instance.id}`,
      label: instance.name,
      detail: 'Instance n8n',
      icon: <ApiOutlined />,
      keywords: 'instance n8n',
      route: `/instances/show/${instance.id}`,
    }));

    return [CREATE_WORKFLOW, ...creations, ...pages, ...instanceCommands, ...TIP_COMMANDS];
  }, [menuItems, resources, instances]);
}

/** Groupe d'affichage d'une commande, déduit de sa clé (une seule source de vérité). */
export function commandGroup(command: Command): 'Actions' | 'Instances' | 'Pages' | 'Astuces' {
  if (command.key.startsWith('create:')) return 'Actions';
  if (command.key.startsWith('instance:')) return 'Instances';
  if (command.key.startsWith('tip:')) return 'Astuces';
  return 'Pages';
}

/**
 * Sans requête, la barre propose les actions et les pages : elle s'ouvre sur
 * quelque chose d'utile plutôt que sur un champ vide. Les instances, elles, ne
 * sortent que si on les cherche — leur liste est déjà dans le menu.
 */
export function filterCommands(commands: Command[], query: string): Command[] {
  if (!query.trim()) {
    return commands.filter((command) => !['Instances', 'Astuces'].includes(commandGroup(command)));
  }
  return commands.filter((command) => matchesQuery(query, command.label, command.detail, command.keywords));
}
