'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Empty, Input, InputRef, Modal, Segmented, Space, Spin, Typography, theme } from 'antd';
import { ApartmentOutlined, SearchOutlined } from '@ant-design/icons';
import { WorkflowRow } from '../app/workflows/workflow-row';
import {
  Command,
  CommandGroup,
  commandGroup,
  filterCommands,
  useStaticCommands,
} from './command-palette-commands';
import { WorkflowHit, preferredMember, useWorkflowSearch } from './command-palette-workflows';
import { useEnvIds } from '../lib/envs';
import { MIN_SEARCH_CHARS } from '../lib/workflow-search';
import { EnvTags, PaletteRow } from './command-palette-row';

/** Mémorise le mode de regroupement d'une session à l'autre : c'est une préférence, pas un filtre. */
const GROUPED_KEY = 'nwm.palette-grouped';

interface PaletteContextValue {
  open: () => void;
}

const CommandPaletteContext = React.createContext<PaletteContextValue | null>(null);

/**
 * Barre de recherche/action globale (⌘K), montée une fois pour toute la console.
 *
 * Atteindre un workflow imposait jusqu'ici d'ouvrir la liste, de la filtrer, puis
 * de cliquer — trois pages pour un nom qu'on connaît déjà.
 */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const input = React.useRef<InputRef>(null);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const value = React.useMemo<PaletteContextValue>(() => ({ open: () => setOpen(true) }), []);

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        closable={false}
        width={640}
        // Le contenu est démonté à la fermeture : la barre se rouvre vide, jamais
        // sur la recherche précédente et ses résultats périmés.
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
        style={{ top: 80 }}
        // Le piège à focus d'antd reprend la main pendant l'ouverture : viser le
        // champ à la fin de l'animation, sinon les premières lettres se perdent.
        afterOpenChange={(opened) => opened && input.current?.focus()}
      >
        {open && <Palette inputRef={input} onDone={() => setOpen(false)} />}
      </Modal>
    </CommandPaletteContext.Provider>
  );
}

/** Ouvre la barre depuis n'importe où ; hors provider, l'appel est sans effet. */
export function useCommandPalette(): PaletteContextValue {
  return React.useContext(CommandPaletteContext) ?? { open: () => undefined };
}

type Entry =
  { kind: 'workflow'; key: string; hit: WorkflowHit } | { kind: 'command'; key: string; command: Command };

interface Section {
  id: 'workflows' | CommandGroup;
  entries: Entry[];
}

function Palette({ inputRef, onDone }: { inputRef: React.RefObject<InputRef>; onDone: () => void }) {
  const { token } = theme.useToken();
  const router = useRouter();
  const [search, setSearch] = React.useState('');
  const [grouped, setGrouped] = React.useState(true);
  const [active, setActive] = React.useState(0);
  const commands = useStaticCommands();
  const envOrder = useEnvIds();
  const { hits, loading, syncing } = useWorkflowSearch(search, grouped);
  const t = useTranslations('shell.commandPalette');

  React.useEffect(() => {
    setGrouped(window.localStorage.getItem(GROUPED_KEY) !== 'false');
    // Focus après le rendu : le champ doit accepter la frappe sans un clic de plus.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [inputRef]);

  const setGroupedPref = (value: boolean) => {
    setGrouped(value);
    window.localStorage.setItem(GROUPED_KEY, String(value));
  };

  const sections = React.useMemo<Section[]>(() => {
    const matched = filterCommands(commands, search);
    const byGroup = (group: CommandGroup) =>
      matched
        .filter((command) => commandGroup(command) === group)
        .map<Entry>((command) => ({ kind: 'command', key: command.key, command }));

    return [
      {
        id: 'workflows' as const,
        entries: hits.map<Entry>((hit) => ({ kind: 'workflow', key: `workflow:${hit.key}`, hit })),
      },
      { id: 'actions' as const, entries: byGroup('actions') },
      { id: 'instances' as const, entries: byGroup('instances') },
      { id: 'pages' as const, entries: byGroup('pages') },
      { id: 'tips' as const, entries: byGroup('tips') },
    ].filter((section) => section.entries.length > 0);
  }, [commands, hits, search]);

  const flat = React.useMemo(() => sections.flatMap((section) => section.entries), [sections]);
  // Position de chaque entrée dans la liste à plat : c'est elle que déplacent les flèches.
  const positions = React.useMemo(
    () => new Map(flat.map((entry, position) => [entry.key, position])),
    [flat],
  );

  // La sélection retombe en tête à chaque nouvelle liste : sinon elle désigne le
  // troisième résultat d'une recherche qui n'existe plus.
  React.useEffect(() => setActive(0), [flat.length, search, grouped]);

  const go = (route: string) => {
    onDone();
    router.push(route);
  };

  const run = (entry: Entry) => {
    if (entry.kind === 'command') go(entry.command.route);
    else go(`/workflows/show/${preferredMember(entry.hit.members, envOrder).id}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (flat.length ? (current + 1) % flat.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (flat.length ? (current - 1 + flat.length) % flat.length : 0));
    } else if (event.key === 'Enter' && flat[active]) {
      event.preventDefault();
      run(flat[active]);
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <Input
        ref={inputRef}
        autoFocus
        variant="borderless"
        size="large"
        prefix={<SearchOutlined style={{ color: token.colorTextSecondary }} />}
        suffix={loading ? <Spin size="small" /> : null}
        placeholder={t('placeholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        style={{ padding: '12px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}` }}
      />
      <div role="listbox" style={{ maxHeight: '55vh', overflowY: 'auto', padding: '8px 0' }}>
        {sections.map((section) => (
          <div key={section.id}>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 11, textTransform: 'uppercase', padding: '4px 16px', display: 'block' }}
            >
              {t(`groups.${section.id}`)}
            </Typography.Text>
            {section.entries.map((entry) => {
              const position = positions.get(entry.key) ?? -1;
              return entry.kind === 'command' ? (
                <PaletteRow
                  key={entry.key}
                  icon={entry.command.icon}
                  label={entry.command.label}
                  detail={entry.command.detail}
                  active={position === active}
                  onHover={() => setActive(position)}
                  onSelect={() => run(entry)}
                />
              ) : (
                <WorkflowEntry
                  key={entry.key}
                  hit={entry.hit}
                  active={position === active}
                  onHover={() => setActive(position)}
                  onSelect={() => run(entry)}
                  onOpenMember={(member: WorkflowRow) => go(`/workflows/show/${member.id}`)}
                />
              );
            })}
          </div>
        ))}
        {flat.length === 0 && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            // Une synchro se dit : elle prend quelques secondes, et un « Aucun
            // résultat » affiché pendant ce temps ferait refermer la barre.
            description={emptyLabel(t, search, loading, syncing)}
            style={{ margin: '24px 0' }}
          />
        )}
      </div>
      <Space
        style={{
          justifyContent: 'space-between',
          width: '100%',
          padding: '8px 16px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('keyboardHint')}
        </Typography.Text>
        <Segmented
          size="small"
          value={grouped ? 'grouped' : 'flat'}
          onChange={(value) => setGroupedPref(value === 'grouped')}
          options={[
            { value: 'grouped', label: t('grouped') },
            { value: 'flat', label: t('flat') },
          ]}
        />
      </Space>
    </div>
  );
}

/** Ce que dit la liste vide : la recherche n'a pas encore de quoi travailler, tourne, ou n'a rien trouvé. */
function emptyLabel(
  t: ReturnType<typeof useTranslations<'shell.commandPalette'>>,
  search: string,
  loading: boolean,
  syncing: boolean,
): string {
  if (syncing) return t('empty.syncing');
  if (loading) return t('empty.loading');
  const term = search.trim();
  if (term.length > 0 && term.length < MIN_SEARCH_CHARS)
    return t('empty.moreChars', { count: MIN_SEARCH_CHARS - term.length });
  return t('empty.noResult');
}

/** Un workflow métier : Entrée ouvre l'env prioritaire, les étiquettes ouvrent les autres. */
function WorkflowEntry({
  hit,
  active,
  onHover,
  onSelect,
  onOpenMember,
}: {
  hit: WorkflowHit;
  active: boolean;
  onHover: () => void;
  onSelect: () => void;
  onOpenMember: (member: WorkflowRow) => void;
}) {
  const t = useTranslations('shell.commandPalette');
  const target = preferredMember(hit.members, useEnvIds());
  return (
    <PaletteRow
      icon={<ApartmentOutlined />}
      label={hit.name}
      detail={
        hit.members.length > 1
          ? target.env
            ? t('opensEnv', { env: target.env })
            : t('opensMain')
          : undefined
      }
      active={active}
      onHover={onHover}
      onSelect={onSelect}
      extra={<EnvTags members={hit.members} target={target} onOpen={onOpenMember} />}
    />
  );
}
