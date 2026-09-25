'use client';

import React from 'react';
import { apiGet, apiPost, isAbortError } from '../lib/api';
import { useInstanceScope } from '../lib/instance-scope';
import { MIN_SEARCH_CHARS, claimSearchSync } from '../lib/workflow-search';
import { WorkflowFamily, WorkflowRow } from '../app/workflows/workflow-row';

/** Nombre de workflows proposés : la barre sert à atteindre le bon, pas à parcourir la liste. */
const LIMIT = 6;
/**
 * La recherche part à la frappe, mais pas à chaque touche : sur une saisie
 * courante (~5 lettres/s), sans ce délai on lance cinq requêtes pour n'en lire
 * qu'une. Celle qui est PARTIE est annulée par la lettre suivante (AbortController).
 */
const DEBOUNCE_MS = 120;

/** Un résultat workflow : un workflow métier et ses environnements, ou un seul workflow n8n. */
export interface WorkflowHit {
  key: string;
  name: string;
  members: WorkflowRow[];
}

/**
 * Le membre qu'ouvre la touche Entrée : l'env le plus AVAL d'abord — c'est celui
 * qu'on vient regarder quand quelque chose cloche —, et jamais une copie archivée
 * ou disparue de n8n tant qu'un exemplaire vivant est disponible.
 */
export function preferredMember(members: WorkflowRow[], envOrder: string[] = []): WorkflowRow {
  const alive = members.filter((member) => !member.archived && !member.missingInN8n);
  const pool = alive.length ? alive : members;
  for (const env of [...envOrder].reverse()) {
    const member = pool.find((candidate) => candidate.env === env);
    if (member) return member;
  }
  return pool[0];
}

function query(search: string, scope: string | null): string {
  const params = new URLSearchParams({
    _start: '0',
    _end: String(LIMIT),
    _sort: 'name',
    _order: 'asc',
    q: search,
  });
  if (scope) params.set('instanceId', scope);
  return params.toString();
}

/**
 * Workflows correspondant à la saisie, groupés par workflow métier par défaut :
 * « X - DEV » et « X - PROD » sont une seule proposition, sans quoi une recherche
 * ne renverrait que des variantes du même workflow.
 *
 * Sans résultat, le miroir local est soupçonné d'être en retard (cron horaire) :
 * on synchronise depuis n8n puis on relance la recherche UNE fois. La synchro
 * n'est tentée qu'une fois par terme — la lettre suivante fait un autre terme,
 * mais l'API tient son propre délai de garde par instance, seul juge fiable
 * quand plusieurs onglets cherchent en même temps.
 */
export function useWorkflowSearch(
  search: string,
  grouped: boolean,
): { hits: WorkflowHit[]; loading: boolean; syncing: boolean } {
  const { scope } = useInstanceScope();
  const [hits, setHits] = React.useState<WorkflowHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const attempted = React.useRef(new Set<string>());
  const term = search.trim();

  React.useEffect(() => {
    if (term.length < MIN_SEARCH_CHARS) {
      setHits([]);
      setLoading(false);
      setSyncing(false);
      return undefined;
    }
    setLoading(true);
    const controller = new AbortController();

    const fetchHits = (): Promise<WorkflowHit[]> =>
      grouped
        ? apiGet<WorkflowFamily[]>(`/workflows/families?${query(term, scope)}`, controller.signal).then(
            (families) =>
              families.map((family) => ({ key: family.id, name: family.name, members: family.members })),
          )
        : apiGet<WorkflowRow[]>(`/workflows?${query(term, scope)}`, controller.signal).then((workflows) =>
            workflows.map((workflow) => ({ key: workflow.id, name: workflow.name, members: [workflow] })),
          );

    const run = async () => {
      try {
        let rows = await fetchHits();
        if (rows.length === 0 && claimSearchSync(term, scope, attempted.current)) {
          setSyncing(true);
          await apiPost('/workflows/search-sync', { instanceId: scope ?? undefined }, controller.signal);
          rows = await fetchHits();
        }
        setHits(rows);
      } catch (error) {
        // Frappe suivante : la requête est abandonnée, ni résultat ni erreur à afficher.
        if (isAbortError(error)) return;
        // Une recherche qui échoue ne montre rien : les autres résultats (actions, pages) restent.
        setHits([]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setSyncing(false);
        }
      }
    };

    const timer = window.setTimeout(() => void run(), DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [term, grouped, scope]);

  return { hits, loading, syncing };
}
