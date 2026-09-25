'use client';

import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { List } from '@refinedev/antd';
import { Button, Empty, Input, Modal, Space, Tag, Typography } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { useEnabledModules } from '../../lib/enabled-modules';
import { useCommandPalette } from '../../components/command-palette';
import { TIP_GROUPS, TIPS, Tip, TipGroupId } from './tip-catalog';
import { groupTips, highlight, matchesTip } from './tip-search';
import { TipVignette } from './tip-vignette';
import './aide.css';

const { Text } = Typography;

function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>{highlight(text, query).map((part, i) => (part.hit ? <mark key={i}>{part.text}</mark> : part.text))}</>
  );
}

function TipCard({ tip, query, off, onOpen }: { tip: Tip; query: string; off: boolean; onOpen: () => void }) {
  const [live, setLive] = React.useState(false);
  return (
    <article
      className={`hp-card${off ? ' off' : ''}`}
      data-tip={tip.id}
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => event.key === 'Enter' && onOpen()}
      onMouseEnter={() => setLive(true)}
      onMouseLeave={() => setLive(false)}
      onFocus={() => setLive(true)}
      onBlur={() => setLive(false)}
    >
      <TipVignette id={tip.id} still={!live} />
      <div className="hp-card-body">
        <h3>
          <Marked text={tip.title} query={query} />
        </h3>
        <p>
          <Marked text={tip.text} query={query} />
        </p>
        <div className="hp-card-foot">
          {off ? <Tag>Module désactivé</Tag> : <Text type="secondary">{tip.where}</Text>}
        </div>
      </div>
    </article>
  );
}

export default function HelpPage() {
  const router = useRouter();
  const params = useSearchParams();
  const palette = useCommandPalette();
  const { enabled } = useEnabledModules();
  const [query, setQuery] = React.useState('');
  const [group, setGroup] = React.useState<TipGroupId | null>(null);

  const isOff = (tip: Tip) => Boolean(enabled && tip.module && !enabled.includes(tip.module));
  const matching = TIPS.filter((tip) => matchesTip(tip, query));
  const shown = matching.filter((tip) => !group || tip.group === group);

  // L'astuce ouverte vit dans l'URL : la palette ⌘K y mène directement.
  const openId = params.get('tip');
  const openIndex = shown.findIndex((tip) => tip.id === openId);
  const open = openIndex >= 0 ? shown[openIndex] : TIPS.find((tip) => tip.id === openId);
  const setOpen = (id: string | null) => router.replace(id ? `/aide?tip=${id}` : '/aide', { scroll: false });
  const step = (delta: number) => {
    if (openIndex < 0) return;
    setOpen(shown[(openIndex + delta + shown.length) % shown.length].id);
  };

  const go = (tip: Tip) => {
    if (tip.href === '#palette') {
      setOpen(null);
      palette.open();
      return;
    }
    router.push(isOff(tip) ? '/modules' : tip.href);
  };

  return (
    <List title="Aide" headerButtons={[]}>
      <div className="hp-root">
        <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 18 }}>
          <Input.Search
            allowClear
            autoFocus
            size="large"
            placeholder="Chercher : promouvoir, colonne, erreur…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div>
            <Tag.CheckableTag checked={!group} onChange={() => setGroup(null)}>
              Tout · {matching.length}
            </Tag.CheckableTag>
            {TIP_GROUPS.map((g) => {
              const count = matching.filter((tip) => tip.group === g.id).length;
              if (!count) return null;
              return (
                <Tag.CheckableTag
                  key={g.id}
                  checked={group === g.id}
                  onChange={(checked) => setGroup(checked ? g.id : null)}
                >
                  {g.label} · {count}
                </Tag.CheckableTag>
              );
            })}
          </div>
        </Space>

        {shown.length === 0 ? (
          <Empty description={`Aucune astuce pour « ${query} »`} />
        ) : (
          groupTips(shown).map((g) => (
            <section key={g.id} className="hp-group">
              <h2>{g.label}</h2>
              <div className="hp-grid">
                {g.tips.map((tip) => (
                  <TipCard
                    key={tip.id}
                    tip={tip}
                    query={query}
                    off={isOff(tip)}
                    onOpen={() => setOpen(tip.id)}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        <Modal
          open={Boolean(open)}
          onCancel={() => setOpen(null)}
          width={560}
          title={open?.title}
          destroyOnHidden
          footer={
            open && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {openIndex >= 0 && shown.length > 1 && (
                  <>
                    <Button icon={<LeftOutlined />} onClick={() => step(-1)} aria-label="Astuce précédente" />
                    <Text type="secondary">
                      {openIndex + 1} / {shown.length}
                    </Text>
                    <Button icon={<RightOutlined />} onClick={() => step(1)} aria-label="Astuce suivante" />
                  </>
                )}
                <Button type="primary" style={{ marginLeft: 'auto' }} onClick={() => go(open)}>
                  {isOff(open) ? 'Activer le module' : 'Essayer'}
                </Button>
              </div>
            )
          }
        >
          {open && (
            <div className="hp-root hp-modal">
              <TipVignette key={open.id} id={open.id} />
              <p style={{ margin: '14px 0 4px' }}>{open.text}</p>
              <Text type="secondary">{open.where}</Text>
            </div>
          )}
        </Modal>
      </div>
    </List>
  );
}
