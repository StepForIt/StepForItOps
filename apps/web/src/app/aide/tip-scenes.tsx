import React from 'react';
import { BRAND } from '../../lib/brand/colors';
import { useTranslations } from 'next-intl';

/*
 * Une scène par astuce : l'écran de la console rejoué en miniature (cadre intérieur 298×158).
 * Les coordonnées du curseur sont celles de la cible dans ce cadre ; classes et timings dans aide.css.
 */

type Click = { x1?: number; y1?: number; x2?: number; y2?: number; mode?: 'one' | 'late' };

function Cursor({ x1 = 0, y1 = 0, x2 = x1, y2 = y1, mode }: Click) {
  const style = {
    '--x1': `${x1}px`,
    '--y1': `${y1}px`,
    '--x2': `${x2}px`,
    '--y2': `${y2}px`,
  } as React.CSSProperties;
  return (
    <svg className={`hp-cur ${mode ?? ''}`} style={style} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 1.5l11 6.2-4.8 1.1L6 13.5z"
        fill="#000"
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const cls = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

function Row({
  children,
  right,
  className,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cls('hp-row', className)}>
      {children}
      {right && <span className="hp-right">{right}</span>}
    </div>
  );
}

function Tag({
  color,
  className,
  style,
  children,
}: {
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span className={cls('hp-tag', color, className)} style={style}>
      {children}
    </span>
  );
}

function Check({ className, on }: { className?: string; on?: boolean }) {
  return <span className={cls('hp-check', on && 'on', className)}>✓</span>;
}

function Frame({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="hp-mw">
      <div className="hp-head">
        {title}
        {right && <span className="hp-right">{right}</span>}
      </div>
      {children}
    </div>
  );
}

const Body = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div className="hp-body" style={style}>
    {children}
  </div>
);

/** Noms de workflows d'exemple, partagés par les scènes. */
function useSample() {
  const t = useTranslations('misc.aide.scenes.sample');
  return { billing: t('billing'), reminders: t('reminders'), quotes: t('quotes') };
}

const EnvTags = () => (
  <>
    <Tag color="blue">DEV</Tag>
    <Tag color="green">PROD</Tag>
  </>
);

function Families() {
  const t = useTranslations('misc.aide.scenes');
  const w = useSample();
  return (
    <Frame
      title={t('shared.workflows')}
      right={
        <span style={{ display: 'flex' }}>
          <span className="hp-btn" style={{ borderRadius: '5px 0 0 5px' }}>
            {t('families.byWorkflow')}
          </span>
          <span className="hp-btn hp-on1 hp-p1" style={{ borderRadius: '0 5px 5px 0', marginLeft: -1 }}>
            {t('families.byFamily')}
          </span>
        </span>
      }
    >
      <div className="hp-gone1">
        <Body>
          <Row right={<Tag color="blue">DEV</Tag>}>{w.billing} - DEV</Row>
          <Row right={<Tag color="green">PROD</Tag>}>{w.billing} - PROD</Row>
          <Row right={<Tag color="blue">DEV</Tag>}>{w.reminders} - DEV</Row>
          <Row right={<Tag color="green">PROD</Tag>}>{w.reminders} - PROD</Row>
        </Body>
      </div>
      <div className="hp-abs hp-a2" style={{ top: 24, left: 0, right: 0 }}>
        <Body>
          <Row
            right={
              <>
                <EnvTags />
                <Tag color="green">{t('shared.equalProd')}</Tag>
              </>
            }
          >
            <span className="hp-muted">▸</span> <b>{w.billing}</b>
          </Row>
          <Row
            right={
              <>
                <EnvTags />
                <Tag color="orange">{t('shared.toDeploy')}</Tag>
              </>
            }
          >
            <span className="hp-muted">▸</span> <b>{w.reminders}</b>
          </Row>
        </Body>
      </div>
      <div className="hp-abs hp-a4" style={{ left: 14, bottom: 10 }}>
        <span className="hp-muted">{t('families.counts')}</span>
      </div>
      <Cursor x1={262} y1={12} mode="one" />
    </Frame>
  );
}

function Divergence() {
  const t = useTranslations('misc.aide.scenes');
  const w = useSample();
  return (
    <Frame title={t('shared.workflows')}>
      <Body>
        <Row right={<Tag color="green">{t('shared.equalProd')}</Tag>}>{w.billing} - DEV</Row>
        <Row
          right={
            <Tag color="orange" className="hp-p1">
              {t('shared.toDeploy')}
            </Tag>
          }
        >
          {w.reminders} - DEV
        </Row>
        <Row right={<Tag color="green">{t('shared.equalProd')}</Tag>}>{w.quotes} - DEV</Row>
      </Body>
      <div className="hp-panel hp-a2" style={{ left: 8, right: 8, top: 102 }}>
        <b>{t('divergence.title', { name: w.reminders })}</b>
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <span className="hp-diff del hp-a3">{t('shared.slackAccounting', { sign: '−' })}</span>
          <span className="hp-diff add hp-a3">{t('shared.slackFinance', { sign: '+' })}</span>
          <span className="hp-diff add hp-a4">{t('divergence.wait')}</span>
        </span>
      </div>
      <Cursor x1={255} y1={65} mode="one" />
    </Frame>
  );
}

function Palette() {
  const t = useTranslations('misc.aide.scenes.palette');
  const w = useSample();
  return (
    <div className="hp-mw" style={{ background: BRAND.papier }}>
      <div className="hp-body" style={{ opacity: 0.5 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{ height: 14, background: BRAND.craie, borderRadius: 4, width: `${90 - i * 12}%` }}
          />
        ))}
      </div>
      <div className="hp-abs hp-gone1" style={{ top: 60, left: 0, right: 0, textAlign: 'center' }}>
        <span className="hp-kbd hp-key">⌘</span> <span className="hp-kbd hp-key">K</span>
      </div>
      <div className="hp-panel hp-a2" style={{ left: 30, right: 30, top: 16 }}>
        <span className="hp-input">
          <span className="hp-muted">⌕</span>
          <span className="hp-type2">{t('typed')}</span>
        </span>
        <span className="hp-muted hp-a3" style={{ fontSize: 9 }}>
          {t('group')}
        </span>
        <Row className="hp-a3" right={<Tag color="green">PROD</Tag>}>
          <span style={{ background: BRAND.primarySoft, margin: '0 -6px', padding: '0 6px', flex: 1 }}>
            {w.reminders} - PROD
          </span>
        </Row>
        <Row className="hp-a3" right={<Tag color="blue">DEV</Tag>}>
          {w.reminders} - DEV
        </Row>
        <span className="hp-muted hp-a5" style={{ fontSize: 9 }}>
          {t('open')}
        </span>
      </div>
    </div>
  );
}

function Bulk() {
  const t = useTranslations('misc.aide.scenes');
  const w = useSample();
  return (
    <Frame title={t('shared.workflows')}>
      <Body>
        <Row right={<Tag color="blue">DEV</Tag>}>
          <Check className="hp-on1 hp-p1" /> {w.billing} - DEV
        </Row>
        <Row right={<Tag color="blue">DEV</Tag>}>
          <Check className="hp-on2 hp-p2" /> {w.reminders} - DEV
        </Row>
        <Row right={<Tag color="blue">DEV</Tag>}>
          <Check /> {w.quotes} - DEV
        </Row>
        <Row right={<Tag color="green">PROD</Tag>}>
          <Check /> {w.quotes} - PROD
        </Row>
      </Body>
      <div
        className="hp-panel hp-a4"
        style={{
          left: 8,
          right: 8,
          bottom: 6,
          flexDirection: 'row',
          alignItems: 'center',
          background: BRAND.primarySoft,
        }}
      >
        <b style={{ whiteSpace: 'nowrap' }}>{t('bulk.selected')}</b>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <span className="hp-btn">{t('bulk.analyze')}</span>
          <span className="hp-btn">{t('bulk.archive')}</span>
        </span>
      </div>
      <Cursor x1={20} y1={41} x2={20} y2={64} />
    </Frame>
  );
}

function Checks() {
  const t = useTranslations('misc.aide.scenes.checks');
  return (
    <Frame
      title={t('title')}
      right={
        <Tag color="green" className="hp-a5">
          {t('launched')}
        </Tag>
      }
    >
      <Body style={{ gap: 0 }}>
        <Row>
          <Check on /> {t('structure')}
        </Row>
        <Row>
          <Check on /> {t('reliability')}
        </Row>
        <Row>
          <Check on className="hp-off1 hp-p1" /> {t('aiReview')}
        </Row>
        <Row>
          <Check on /> {t('jsCode')}
        </Row>
        <Row>
          <Check on /> {t('naming')}
        </Row>
      </Body>
      <span className="hp-btn primary hp-abs hp-p2" style={{ right: 8, bottom: 8 }}>
        {t('launch')}
      </span>
      <Cursor x1={20} y1={87} x2={268} y2={140} />
    </Frame>
  );
}

function FindingsFix() {
  const t = useTranslations('misc.aide.scenes');
  const w = useSample();
  return (
    <Frame title={t('findingsFix.title', { name: w.reminders })}>
      <Body style={{ gap: 0 }}>
        <Row right={<span className="hp-btn hp-p1">{t('findingsFix.fix')}</span>}>
          <b>HTTP Stripe</b> <Tag color="red">1</Tag>
          <Tag color="orange">2</Tag>
        </Row>
        <Row>
          <span className="hp-ko">✕</span> {t('findingsFix.noTimeout')}
        </Row>
        <Row>
          <span style={{ color: BRAND.warning }}>!</span> {t('findingsFix.noRetry')}
        </Row>
        <Row>
          <span style={{ color: BRAND.warning }}>!</span> {t('findingsFix.swallowed')}
        </Row>
      </Body>
      <div className="hp-panel hp-a2" style={{ left: 110, right: 8, top: 50 }}>
        <b>{t('findingsFix.proposal')}</b>
        <span className="hp-diff add hp-a3">{t('findingsFix.timeout')}</span>
        <span className="hp-diff add hp-a3">{t('findingsFix.retry')}</span>
        <span className="hp-diff add hp-a4">+ onError: stop</span>
        <span className="hp-a5" style={{ display: 'flex', gap: 4 }}>
          <span className="hp-btn primary">{t('shared.apply')}</span>
          <span className="hp-btn">{t('findingsFix.seeDiff')}</span>
        </span>
      </div>
      <Cursor x1={250} y1={41} mode="one" />
    </Frame>
  );
}

function Ignore() {
  const t = useTranslations('misc.aide.scenes.ignore');
  return (
    <Frame title="Findings">
      <Body style={{ gap: 0 }}>
        <Row className="hp-gone2" right={<span className="hp-btn hp-p1">{t('ignore')}</span>}>
          <span style={{ color: BRAND.warning }}>!</span> {t('placeholder')}
        </Row>
        <Row>
          <span style={{ color: BRAND.warning }}>!</span> {t('unnamed')}
        </Row>
        <Row>
          <span className="hp-ko">✕</span> {t('missingRef')}
        </Row>
      </Body>
      <div className="hp-abs hp-a2" style={{ left: 120, right: 8, top: 44 }}>
        <div className="hp-panel hp-gone2" style={{ position: 'relative' }}>
          <b>{t('ignoreFor')}</b>
          <span>{t('thisWorkflow')}</span>
          <span>
            <b style={{ color: BRAND.primary }}>●</b> {t('allEnvs')}
          </span>
          <span>{t('everywhere')}</span>
          <span style={{ alignSelf: 'flex-end' }} className="hp-btn primary hp-p2">
            {t('ignore')}
          </span>
        </div>
      </div>
      <Tag color="green" className="hp-note hp-a5">
        {t('done')}
      </Tag>
      <Cursor x1={262} y1={41} x2={263} y2={130} />
    </Frame>
  );
}

function Stub() {
  const t = useTranslations('misc.aide.scenes.stub');
  return (
    <Frame title={t('title')}>
      <Body style={{ gap: 0 }}>
        <Row right={<span className="hp-muted">{t('input')}</span>}>
          <Check /> Webhook
        </Row>
        <Row right={<Tag color="orange">{t('out')}</Tag>}>
          <Check on className="hp-a1" /> {t('gmail')}
        </Row>
        <Row right={<Tag color="orange">{t('out')}</Tag>}>
          <Check on className="hp-a1" /> {t('slack')}
        </Row>
        <Row right={<Tag color="orange">{t('out')}</Tag>}>
          <Check on className="hp-a1" /> HTTP POST · Stripe
        </Row>
      </Body>
      <Tag color="green" className="hp-note hp-a3">
        {t('summary')}
      </Tag>
      <span className="hp-btn primary hp-abs hp-p1" style={{ right: 8, bottom: 8 }}>
        {t('run')}
      </span>
      <Cursor x1={255} y1={140} mode="one" />
    </Frame>
  );
}

function Remote() {
  const t = useTranslations('misc.aide.scenes.remote');
  return (
    <Frame title={t('title')} right={<span className="hp-btn hp-p1">{t('check')}</span>}>
      <Body style={{ gap: 0 }}>
        <Row right={<span className="hp-ok hp-a2">✓</span>}>{t('name')}</Row>
        <Row right={<span className="hp-ok hp-a2">✓</span>}>Email</Row>
        <Row
          right={
            <Tag color="red" className="hp-a3">
              {t('absent')}
            </Tag>
          }
        >
          {t('phone')}
        </Row>
        <Row right={<span className="hp-ok hp-a3">✓</span>}>{t('status')}</Row>
      </Body>
      <Tag color="red" className="hp-note hp-a5">
        {t('missing', { column: t('phone') })}
      </Tag>
      <Cursor x1={245} y1={12} mode="one" />
    </Frame>
  );
}

const DRAWER: React.CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 0,
  bottom: 0,
  width: 178,
  background: '#fff',
  borderLeft: '1px solid #f0f0f0',
  boxShadow: '-4px 0 12px rgba(0,0,0,.06)',
};

function MiniGraph({ glow }: { glow?: boolean }) {
  const node = (label: string, x: number, y: number, extra?: string) => (
    <span
      className={cls('hp-btn hp-abs', extra)}
      style={{ left: x, top: y, height: 22, borderRadius: 6, fontSize: 9 }}
    >
      {label}
    </span>
  );
  return (
    <>
      {node('Webhook', 8, 40)}
      {node('HTTP', 30, 74, glow ? 'hp-glow' : undefined)}
      {node('Slack', 8, 108)}
    </>
  );
}

function Assistant() {
  const t = useTranslations('misc.aide.scenes');
  const w = useSample();
  return (
    <div className="hp-mw">
      <div className="hp-head">{w.reminders} - DEV</div>
      <MiniGraph glow />
      <div style={DRAWER}>
        <div className="hp-head">{t('shared.assistant')}</div>
        <div className="hp-bubble me hp-abs hp-a2" style={{ right: 8, top: 32, maxWidth: 150 }}>
          {t('assistant.ask')}
        </div>
        <div className="hp-bubble ai hp-abs hp-a3" style={{ left: 8, top: 70, width: 140 }}>
          {t('assistant.ready')}
          <br />
          <span className="hp-muted">{t('assistant.detail')}</span>
        </div>
        <span className="hp-btn primary hp-abs hp-a3" style={{ left: 16, top: 112 }}>
          {t('shared.apply')}
        </span>
        <Tag color="green" className="hp-abs hp-a4" style={{ left: 90, top: 116 }}>
          {t('assistant.applied')}
        </Tag>
        <div className="hp-input hp-abs" style={{ left: 6, right: 32, bottom: 6 }}>
          <span className="hp-gone1">
            <span className="hp-type1">{t('assistant.typing')}</span>
          </span>
        </div>
        <span className="hp-btn primary hp-abs hp-p1" style={{ right: 6, bottom: 6, padding: '0 5px' }}>
          ➤
        </span>
      </div>
      <Cursor x1={282} y1={142} x2={160} y2={122} />
    </div>
  );
}

function ErrorFix() {
  const t = useTranslations('misc.aide.scenes');
  return (
    <div className="hp-mw">
      <div className="hp-head">{t('errorFix.title')}</div>
      <div className="hp-body">
        <div className="hp-panel" style={{ position: 'relative', boxShadow: 'none', width: 104 }}>
          <span>
            <span className="hp-dot red" style={{ display: 'inline-block' }} /> <b>401</b> <Tag>12×</Tag>
          </span>
          <span className="hp-muted">HTTP · Stripe</span>
          <span className="hp-btn hp-p1" style={{ fontSize: 8.5, padding: '0 5px' }}>
            {t('errorFix.fix')}
          </span>
        </div>
        <div className="hp-panel" style={{ position: 'relative', boxShadow: 'none', width: 104 }}>
          <span>
            <span className="hp-dot orange" style={{ display: 'inline-block' }} /> <b>Timeout</b>{' '}
            <Tag>3×</Tag>
          </span>
          <span className="hp-muted">Notion</span>
        </div>
      </div>
      <div className="hp-a2" style={{ ...DRAWER, width: 170 }}>
        <div className="hp-head">{t('shared.assistant')}</div>
        <div className="hp-bubble ai hp-abs hp-a3" style={{ left: 8, top: 34, width: 140 }}>
          <b>{t('errorFix.expired')}</b>
        </div>
        <div className="hp-bubble ai hp-abs hp-a4" style={{ left: 8, top: 66, width: 140 }}>
          {t('errorFix.renew')}
        </div>
      </div>
      <Cursor x1={60} y1={76} mode="one" />
    </div>
  );
}

function Promote() {
  const t = useTranslations('misc.aide.scenes.promote');
  const w = useSample();
  return (
    <Frame title={t('title', { name: w.billing })}>
      <Body>
        <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <Tag color="blue">DEV</Tag>→<Tag>PREPROD</Tag>→<span className="hp-tag green hp-glow">PROD</span>
          <Tag className="hp-a5" color="green">
            {t('inProd')}
          </Tag>
        </span>
        <span className="hp-a1">
          <span className="hp-ok">✓</span> {t('testsGreen')}
        </span>
        <span className="hp-a2">
          <span className="hp-ok">✓</span> {t('noBlocking')}
        </span>
        <span className="hp-a3">
          <span className="hp-ok">✓</span> {t('columnsPresent')}
        </span>
        <span className="hp-a3">
          {t('version')} <span className="hp-muted">1.2.0 →</span> <b>1.3.0</b>
        </span>
      </Body>
      <span className="hp-btn primary hp-abs hp-p2" style={{ right: 8, bottom: 8 }}>
        {t('promote')}
      </span>
      <Cursor x2={262} y2={140} mode="late" />
    </Frame>
  );
}

function Mapping() {
  const t = useTranslations('misc.aide.scenes.mapping');
  const swap = (before: React.ReactNode, after: React.ReactNode, step: string) => (
    <span style={{ position: 'relative', display: 'inline-block', minWidth: 150 }}>
      <span className="hp-gone1">{before}</span>
      <span className={cls('hp-abs', step)} style={{ left: 0, top: 0 }}>
        {after}
      </span>
    </span>
  );
  return (
    <Frame title={t('title')} right={<Tag color="blue">DEV</Tag>}>
      <Body style={{ gap: 7 }}>
        <span>
          <span className="hp-muted">{t('base')} </span>
          {swap(
            <>
              <b>CRM (dev)</b> <span className="hp-muted">appD3v…</span>
            </>,
            <>
              <b>CRM (prod)</b> <span className="hp-muted">appPr0…</span>
            </>,
            'hp-a2',
          )}
        </span>
        <span>
          <span className="hp-muted">{t('table')} </span>
          {swap(<b>{t('prospects', { env: 'dev' })}</b>, <b>{t('prospects', { env: 'prod' })}</b>, 'hp-a3')}
        </span>
        <span>
          <span className="hp-muted">Credential </span>
          {swap(<b>Airtable dev</b>, <b>Airtable prod</b>, 'hp-a4')}
        </span>
      </Body>
      <Tag color="green" className="hp-note hp-a5">
        {t('summary')}
      </Tag>
      <span className="hp-btn primary hp-abs hp-p1" style={{ right: 8, bottom: 8 }}>
        {t('switch')}
      </span>
      <Cursor x1={250} y1={140} mode="one" />
    </Frame>
  );
}

function Errors() {
  const t = useTranslations('misc.aide.scenes.errors');
  return (
    <Frame title={t('title')}>
      <Body style={{ gap: 0, width: 120 }}>
        <Row className="hp-a1">
          <span className="hp-dot red" /> 10:02 Timeout
        </Row>
        <Row className="hp-a1">
          <span className="hp-dot red" /> 10:07 Timeout
        </Row>
        <Row className="hp-a2">
          <span className="hp-dot red" /> 10:12 Timeout
        </Row>
        <Row className="hp-a5">
          <span className="hp-dot red" /> <b>10:40 Timeout</b>
        </Row>
      </Body>
      <div className="hp-panel" style={{ left: 140, right: 8, top: 34 }}>
        <b>Timeout · Notion</b>
        <span className="hp-muted">{t('grouped')}</span>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span className="hp-btn hp-p2">{t('resolve')}</span>
          <Tag color="green" className="hp-a4">
            {t('resolved')}
          </Tag>
        </span>
        <Tag color="orange" className="hp-a5">
          {t('reopened')}
        </Tag>
      </div>
      <Cursor x2={172} y2={82} mode="late" />
    </Frame>
  );
}

function Drift() {
  const t = useTranslations('misc.aide.scenes.drift');
  const w = useSample();
  const bars = [30, 34, 28, 32, 36, 31, 33, 29, 52, 58, 61];
  return (
    <Frame
      title={t('title', { name: w.reminders })}
      right={
        <Tag color="red" className="hp-a4">
          {t('ratio')}
        </Tag>
      }
    >
      <div
        className="hp-abs"
        style={{
          left: 14,
          right: 14,
          bottom: 14,
          height: 90,
          display: 'flex',
          gap: 6,
          alignItems: 'flex-end',
        }}
      >
        {bars.map((h, i) => (
          <span
            key={i}
            className="hp-rise"
            style={{
              flex: 1,
              height: h * 1.4,
              borderRadius: 3,
              background: i >= 8 ? BRAND.corail : '#91caff',
            }}
          />
        ))}
      </div>
      <div className="hp-panel hp-a5" style={{ right: 10, top: 32, width: 150 }}>
        <b>{t('channel')}</b>
        <span>{t('message', { name: w.reminders })}</span>
      </div>
    </Frame>
  );
}

function Costs() {
  const t = useTranslations('misc.aide.scenes.costs');
  const rows: Array<[string, number]> = [
    [t('mailSorting'), 62],
    [t('ticketSummary'), 38],
    [t('aiQuotes'), 21],
  ];
  return (
    <Frame title={t('title')} right={<b className="hp-a4">{t('total')}</b>}>
      <Body style={{ gap: 10, paddingTop: 12 }}>
        {rows.map(([label, pct]) => (
          <span
            key={label}
            style={{ display: 'grid', gridTemplateColumns: '84px 1fr', alignItems: 'center', gap: 6 }}
          >
            <span>{label}</span>
            <span className="hp-bar hp-grow" style={{ width: `${pct}%` }} />
          </span>
        ))}
      </Body>
      <Tag color="orange" className="hp-note hp-a5">
        {t('overBudget')}
      </Tag>
    </Frame>
  );
}

function Restore() {
  const t = useTranslations('misc.aide.scenes');
  const w = useSample();
  return (
    <Frame title={t('restore.title', { name: w.billing })}>
      <Body style={{ gap: 0 }}>
        <Row right={<Tag color="blue">{t('restore.current')}</Tag>}>
          <b>v14</b> <span className="hp-muted">{t('restore.today')}</span>
        </Row>
        <Row>
          <b>v13</b> <span className="hp-muted">{t('restore.yesterday')}</span>
        </Row>
        <Row right={<span className="hp-btn hp-p1">{t('restore.restore')}</span>}>
          <b>v12</b> <span className="hp-muted">{t('restore.monday')}</span>
        </Row>
      </Body>
      <div className="hp-abs hp-a2" style={{ left: 96, right: 8, top: 40 }}>
        <div className="hp-panel hp-gone2" style={{ position: 'relative' }}>
          <b>{t('restore.confirm')}</b>
          <span className="hp-diff del">{t('shared.slackFinance', { sign: '−' })}</span>
          <span className="hp-diff add">{t('shared.slackAccounting', { sign: '+' })}</span>
          <span style={{ alignSelf: 'flex-end' }} className="hp-btn primary hp-p2">
            {t('restore.restore')}
          </span>
        </div>
      </div>
      <Tag color="green" className="hp-note hp-a5">
        {t('restore.done')}
      </Tag>
      <Cursor x1={262} y1={87} x2={260} y2={117} />
    </Frame>
  );
}

function Resources() {
  const t = useTranslations('misc.aide.scenes.resources');
  const w = useSample();
  return (
    <Frame title={t('title')}>
      <Body>
        <span className="hp-input">
          <span className="hp-muted">⌕</span>
          <span className="hp-type1">crm</span>
        </span>
        <b className="hp-a2">Airtable · CRM · Prospects</b>
        <Row className="hp-a3" right={<span className="hp-muted">{t('writes')}</span>}>
          {w.billing} - PROD
        </Row>
        <Row className="hp-a4" right={<span className="hp-muted">{t('readsAll')}</span>}>
          {w.reminders} - PROD
        </Row>
        <Row className="hp-a5" right={<Tag color="orange">{t('reopen')}</Tag>}>
          {w.quotes} - PROD
        </Row>
      </Body>
    </Frame>
  );
}

function ListMemory() {
  const t = useTranslations('misc.aide.scenes');
  const w = useSample();
  return (
    <Frame title={t('shared.workflows')}>
      <Body>
        <Row right={<span className="hp-muted hp-p1">⚙</span>}>
          <span className="hp-muted">{t('listMemory.name')}</span>
          <span className="hp-muted" style={{ marginLeft: 70 }}>
            Env
          </span>
          <span className="hp-muted hp-gone2" style={{ marginLeft: 22 }}>
            {t('listMemory.tags')}
          </span>
        </Row>
        <Row right={<Tag color="green">PROD</Tag>}>{w.billing}</Row>
        <Row right={<Tag color="green">PROD</Tag>}>{w.reminders}</Row>
      </Body>
      <div className="hp-panel hp-a2" style={{ right: 8, top: 44, width: 110 }}>
        <span>
          <Check on /> {t('listMemory.name')}
        </span>
        <span>
          <Check on /> Env
        </span>
        <span>
          <Check on className="hp-p2" /> {t('listMemory.tags')}
        </span>
      </div>
      <div className="hp-abs hp-a4" style={{ left: 14, bottom: 10 }}>
        <span className="hp-muted">{t('listMemory.kept')}</span>
      </div>
      <Cursor x1={280} y1={42} x2={195} y2={96} />
    </Frame>
  );
}

export const SCENES: Record<string, () => React.ReactElement> = {
  families: Families,
  divergence: Divergence,
  palette: Palette,
  bulk: Bulk,
  checks: Checks,
  'findings-fix': FindingsFix,
  ignore: Ignore,
  stub: Stub,
  remote: Remote,
  assistant: Assistant,
  'error-fix': ErrorFix,
  promote: Promote,
  mapping: Mapping,
  errors: Errors,
  drift: Drift,
  costs: Costs,
  restore: Restore,
  resources: Resources,
  'list-memory': ListMemory,
};
