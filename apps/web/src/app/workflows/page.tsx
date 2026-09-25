'use client';

import React, { useMemo, useState } from 'react';
import { List } from '@refinedev/antd';
import { CrudFilters, useInvalidate, useSelect } from '@refinedev/core';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Input, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useInstanceScope } from '../../lib/instance-scope';
import { useEnabledModules } from '../../lib/enabled-modules';
import { apiGet } from '../../lib/api';
import { useWorkflowChat } from '../../components/workflow-chat-drawer';
import { CreateWorkflowModal } from './create-workflow-modal';
import { WorkflowsTable } from './workflows-table';
import { MIN_SEARCH_CHARS } from '../../lib/workflow-search';
import { WorkflowFamiliesTable } from './families-table';
import { WebhookPathsModal } from './webhook-paths-modal';
import { useEnvOptions } from '../../lib/envs';
import { WorkflowBulkActions } from './bulk-actions';
import { FamilyBulkBar } from './bulk-env/bulk-env-buttons';
import { WorkflowFamily, WorkflowRow } from './workflow-row';
import { usePersistedState } from '../../lib/list-memory/use-list-memory';
import { DEFAULT_FILTERS, Filters, activeFilterCount } from './workflow-filters';
import { WorkflowFilterControls } from './workflow-filter-controls';
import { MobileFilterBar } from '../../components/mobile/mobile-filter-bar';
import { useIsMobile } from '../../components/mobile/use-is-mobile';
import { MOBILE_TOP_BAR_HEIGHT } from '../../components/mobile-top-bar';
import { WorkflowsMobileList } from './mobile/workflows-mobile-list';
import { FamiliesMobileList } from './mobile/families-mobile-list';

interface GroupOption {
  id: string;
  name: string;
  instanceId: string;
}

export default function WorkflowsList() {
  const envOptions = useEnvOptions();
  const divergenceOptions = [
    ...envOptions
      .filter((env) => env.value !== 'prod')
      .map((env) => ({ value: env.value, label: `${env.label} à déployer` })),
    { value: 'diverged', label: 'Différents de la prod' },
    { value: 'behind', label: 'Prod modifiée depuis' },
  ];
  const { scope, instanceName } = useInstanceScope();
  const [filters, setFilters] = usePersistedState<Filters>('filters', DEFAULT_FILTERS);
  const [pathsOpen, setPathsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // Sélection des actions groupées : elle porte sur des workflows n8n dans les
  // deux vues, la vue groupée cochant les membres d'une famille et non la famille.
  const [selected, setSelected] = useState<WorkflowRow[]>([]);
  // Gestes d'environnement : ils portent sur des workflows MÉTIER, pas sur des exemplaires.
  const [selectedFamilies, setSelectedFamilies] = useState<WorkflowFamily[]>([]);
  // Sur mobile, la liste passe en lignes dépliables et les filtres dans un tiroir.
  const mobile = useIsMobile();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chat = useWorkflowChat();
  const invalidate = useInvalidate();
  const { enabled } = useEnabledModules();
  const { options: instanceOptions } = useSelect({
    resource: 'instances',
    optionLabel: 'name',
    optionValue: 'id',
  });

  // Les groupes servent de filtre : sans cette entrée, savoir ce que contient un
  // domaine imposait d'ouvrir sa fiche. Chargés une fois, tous instances confondues.
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const groupsEnabled = !enabled || enabled.includes('workflow-groups');
  React.useEffect(() => {
    if (!groupsEnabled) return;
    apiGet<GroupOption[]>('/workflow-groups?_start=0&_end=200&_sort=name&_order=asc')
      .then(setGroups)
      .catch(() => setGroups([]));
  }, [groupsEnabled]);

  // La vue choisie vit dans l'URL : un lien collé à un collègue, un favori ou un
  // retour arrière rouvrent celle qu'on regardait. Groupée par défaut — le
  // workflow métier est l'unité de lecture, « X - DEV » et « X - PROD » font une ligne.
  // Sans `view` dans l'URL (retour par le menu), c'est la dernière vue choisie qui revient.
  const [lastView, setLastView] = usePersistedState<'grouped' | 'flat'>('view', 'grouped');
  const urlView = searchParams.get('view');
  const grouped = (urlView ?? lastView) !== 'flat';
  // La vue n'est retenue qu'une fois l'URL arrivée : changée avant, elle montait la
  // nouvelle table trop tôt, et son `useTable` réécrivait l'URL sans `view`. Seul le
  // geste d'ici est retenu — une vue arrivée par un lien partagé ne l'est pas.
  const requestedView = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!urlView || urlView !== requestedView.current) return;
    requestedView.current = null;
    setLastView(urlView === 'flat' ? 'flat' : 'grouped');
  }, [urlView, setLastView]);
  const showGrouped = (next: boolean) => {
    requestedView.current = next ? 'grouped' : 'flat';
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', next ? 'grouped' : 'flat');
    router.push(`/workflows?${params.toString()}`);
  };

  const set = React.useCallback(
    (field: keyof Filters) => (value?: string) =>
      setFilters((current) => ({ ...current, [field]: value || undefined })),
    [setFilters],
  );

  // La recherche part à la frappe, sans passer par la loupe ni par Entrée : sous
  // MIN_SEARCH_CHARS caractères elle ne filtre rien (le champ vidé remet la liste
  // entière), et le délai évite une requête par lettre — la liste en compte deux,
  // les lignes et leur total.
  const [text, setText] = useState(filters.q ?? '');
  React.useEffect(() => {
    const term = text.trim();
    const next = term.length >= MIN_SEARCH_CHARS ? term : undefined;
    const timer = window.setTimeout(() => set('q')(next), 250);
    return () => window.clearTimeout(timer);
  }, [text, set]);

  // Le scope global l'emporte sur le sélecteur d'instance (masqué quand il est posé).
  const crudFilters = useMemo<CrudFilters>(() => {
    const entries: Array<[string, string | undefined]> = [
      ['instanceId', scope ?? filters.instanceId],
      ['q', filters.q],
      ['env', filters.env],
      ['active', filters.active],
      ['groupId', filters.groupId],
      ['divergence', filters.divergence],
      ['archived', filters.archived === 'default' ? undefined : filters.archived],
    ];
    return entries
      .filter(([, value]) => Boolean(value))
      .map(([field, value]) => ({ field, operator: 'eq' as const, value }));
  }, [scope, filters]);

  // Un groupe appartient à une instance : hors de son instance, le proposer
  // n'aurait aucun résultat à donner.
  const instanceFilter = scope ?? filters.instanceId;
  const groupOptions = groups
    .filter((group) => !instanceFilter || group.instanceId === instanceFilter)
    .map((group) => ({ value: group.id, label: group.name }));

  // Un filtre retenu sur une instance ou un groupe supprimé depuis ne filtrerait plus
  // que du vide : on l'oublie dès que la liste des choix est connue.
  React.useEffect(() => {
    if (
      filters.instanceId &&
      instanceOptions.length > 0 &&
      !instanceOptions.some((o) => o.value === filters.instanceId)
    )
      set('instanceId')(undefined);
  }, [instanceOptions, filters.instanceId, set]);
  React.useEffect(() => {
    if (filters.groupId && groups.length > 0 && !groups.some((group) => group.id === filters.groupId))
      set('groupId')(undefined);
  }, [groups, filters.groupId, set]);

  // « Créer un workflow » depuis la barre de recherche globale : la création est
  // une fenêtre de cette page, donc la commande y amène avec ce paramètre, retiré
  // aussitôt lu — sinon un retour arrière rouvrirait la fenêtre.
  React.useEffect(() => {
    if (searchParams.get('create') === null) return;
    setCreateOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('create');
    const rest = params.toString();
    router.replace(rest ? `/workflows?${rest}` : '/workflows');
  }, [searchParams, router]);

  // Les deux vues sont deux resources Refine distinctes : une action groupée
  // faite dans l'une doit aussi périmer l'autre.
  const refreshList = () => {
    invalidate({ resource: 'workflows', invalidates: ['list'] });
    invalidate({ resource: 'workflows/families', invalidates: ['list'] });
  };

  const selection = useMemo(
    () => ({
      ids: selected.map((workflow) => workflow.id),
      onSelect: (scope: WorkflowRow[], rows: WorkflowRow[]) =>
        setSelected((current) => {
          const scoped = new Set(scope.map((workflow) => workflow.id));
          return [...current.filter((workflow) => !scoped.has(workflow.id)), ...rows];
        }),
    }),
    [selected],
  );

  // Un changement de filtre ou de vue renouvelle les lignes : garder des cases
  // cochées sur des workflows qu'on ne voit plus, c'est agir à l'aveugle.
  const familySelection = useMemo(
    () => ({
      keys: selectedFamilies.map((family) => family.id),
      onSelect: (scope: WorkflowFamily[], rows: WorkflowFamily[]) =>
        setSelectedFamilies((current) => {
          const scoped = new Set(scope.map((family) => family.id));
          return [...current.filter((family) => !scoped.has(family.id)), ...rows];
        }),
    }),
    [selectedFamilies],
  );

  React.useEffect(() => {
    setSelected([]);
    setSelectedFamilies([]);
  }, [crudFilters, grouped]);

  // Mobile : l'appui long ouvre le mode sélection, qui dure tant qu'une ligne est cochée.
  const selecting = selected.length > 0 || selectedFamilies.length > 0;
  const searchPlaceholder = `Rechercher par nom (${MIN_SEARCH_CHARS} caractères)…`;
  const filterControls = (block: boolean) => (
    <WorkflowFilterControls
      filters={filters}
      setFilters={setFilters}
      scoped={Boolean(scope)}
      instanceOptions={instanceOptions}
      envOptions={envOptions}
      divergenceOptions={divergenceOptions}
      groupOptions={groupOptions}
      grouped={grouped}
      onGroupedChange={showGrouped}
      onOpenPaths={() => setPathsOpen(true)}
      block={block}
    />
  );
  const listProps = {
    filters: crudFilters,
    search: filters.q,
    instanceId: scope ?? filters.instanceId ?? null,
    instanceName,
    selection,
  };

  return (
    <List
      headerButtons={
        mobile ? (
          <Button
            type="primary"
            shape="circle"
            icon={<PlusOutlined />}
            aria-label="Créer un workflow"
            onClick={() => setCreateOpen(true)}
          />
        ) : (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Créer un workflow
          </Button>
        )
      }
    >
      {mobile ? (
        <MobileFilterBar
          search={text}
          onSearch={setText}
          searchPlaceholder={searchPlaceholder}
          activeCount={activeFilterCount(filters, { scoped: Boolean(scope) })}
          onReset={() => setFilters({ ...DEFAULT_FILTERS, q: filters.q })}
        >
          {filterControls(true)}
        </MobileFilterBar>
      ) : (
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            placeholder={searchPlaceholder}
            allowClear
            style={{ width: 260 }}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onSearch={setText}
          />
          {filterControls(false)}
        </Space>
      )}
      <WebhookPathsModal open={pathsOpen} onClose={() => setPathsOpen(false)} />
      <CreateWorkflowModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(workflow) => {
          setCreateOpen(false);
          refreshList();
          // Le workflow est vide : l'assistant s'ouvre dans la foulée pour demander
          // ce qu'il doit faire, sans changement de page.
          chat.open({
            workflowId: workflow.id,
            workflowName: workflow.name,
            onWorkflowChanged: refreshList,
          });
        }}
      />
      {/* Sur mobile, la barre d'actions reste en haut de l'écran pendant qu'on coche en faisant défiler. */}
      <div
        style={
          mobile && selecting
            ? // Sous la barre du haut (menu), elle aussi collée en haut de l'écran.
              { position: 'sticky', top: MOBILE_TOP_BAR_HEIGHT, zIndex: 10 }
            : undefined
        }
      >
        {selected.length > 0 && (
          <WorkflowBulkActions selected={selected} onDone={refreshList} onClear={() => setSelected([])} />
        )}
        {grouped && selectedFamilies.length > 0 && (
          <FamilyBulkBar
            families={selectedFamilies}
            onApplied={refreshList}
            onClear={() => setSelectedFamilies([])}
          />
        )}
      </div>
      {mobile ? (
        grouped ? (
          <FamiliesMobileList {...listProps} familySelection={familySelection} selecting={selecting} />
        ) : (
          <WorkflowsMobileList {...listProps} showInstance={!scope} selecting={selecting} />
        )
      ) : grouped ? (
        <WorkflowFamiliesTable {...listProps} familySelection={familySelection} />
      ) : (
        <WorkflowsTable {...listProps} showInstance={!scope} />
      )}
    </List>
  );
}
