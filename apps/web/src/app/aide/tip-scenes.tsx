import React from 'react';

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

const EnvTags = () => (
  <>
    <Tag color="blue">DEV</Tag>
    <Tag color="green">PROD</Tag>
  </>
);

function Families() {
  return (
    <Frame
      title="Workflows"
      right={
        <span style={{ display: 'flex' }}>
          <span className="hp-btn" style={{ borderRadius: '5px 0 0 5px' }}>
            Par workflow
          </span>
          <span className="hp-btn hp-on1 hp-p1" style={{ borderRadius: '0 5px 5px 0', marginLeft: -1 }}>
            Par métier
          </span>
        </span>
      }
    >
      <div className="hp-gone1">
        <Body>
          <Row right={<Tag color="blue">DEV</Tag>}>Facturation - DEV</Row>
          <Row right={<Tag color="green">PROD</Tag>}>Facturation - PROD</Row>
          <Row right={<Tag color="blue">DEV</Tag>}>Relances - DEV</Row>
          <Row right={<Tag color="green">PROD</Tag>}>Relances - PROD</Row>
        </Body>
      </div>
      <div className="hp-abs hp-a2" style={{ top: 24, left: 0, right: 0 }}>
        <Body>
          <Row
            right={
              <>
                <EnvTags />
                <Tag color="green">= prod</Tag>
              </>
            }
          >
            <span className="hp-muted">▸</span> <b>Facturation</b>
          </Row>
          <Row
            right={
              <>
                <EnvTags />
                <Tag color="orange">à déployer</Tag>
              </>
            }
          >
            <span className="hp-muted">▸</span> <b>Relances</b>
          </Row>
        </Body>
      </div>
      <div className="hp-abs hp-a4" style={{ left: 14, bottom: 10 }}>
        <span className="hp-muted">4 workflows · 2 métiers</span>
      </div>
      <Cursor x1={262} y1={12} mode="one" />
    </Frame>
  );
}

function Divergence() {
  return (
    <Frame title="Workflows">
      <Body>
        <Row right={<Tag color="green">= prod</Tag>}>Facturation - DEV</Row>
        <Row
          right={
            <Tag color="orange" className="hp-p1">
              à déployer
            </Tag>
          }
        >
          Relances - DEV
        </Row>
        <Row right={<Tag color="green">= prod</Tag>}>Devis - DEV</Row>
      </Body>
      <div className="hp-panel hp-a2" style={{ left: 8, right: 8, top: 102 }}>
        <b>Relances : DEV → PROD</b>
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <span className="hp-diff del hp-a3">− Slack · #compta</span>
          <span className="hp-diff add hp-a3">+ Slack · #finance</span>
          <span className="hp-diff add hp-a4">+ Wait · 5 min</span>
        </span>
      </div>
      <Cursor x1={255} y1={65} mode="one" />
    </Frame>
  );
}

function Palette() {
  return (
    <div className="hp-mw" style={{ background: '#f5f5f5' }}>
      <div className="hp-body" style={{ opacity: 0.5 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{ height: 14, background: '#e8e8e8', borderRadius: 4, width: `${90 - i * 12}%` }}
          />
        ))}
      </div>
      <div className="hp-abs hp-gone1" style={{ top: 60, left: 0, right: 0, textAlign: 'center' }}>
        <span className="hp-kbd hp-key">⌘</span> <span className="hp-kbd hp-key">K</span>
      </div>
      <div className="hp-panel hp-a2" style={{ left: 30, right: 30, top: 16 }}>
        <span className="hp-input">
          <span className="hp-muted">⌕</span>
          <span className="hp-type2">relan</span>
        </span>
        <span className="hp-muted hp-a3" style={{ fontSize: 9 }}>
          WORKFLOWS
        </span>
        <Row className="hp-a3" right={<Tag color="green">PROD</Tag>}>
          <span style={{ background: '#e6f4ff', margin: '0 -6px', padding: '0 6px', flex: 1 }}>
            Relances - PROD
          </span>
        </Row>
        <Row className="hp-a3" right={<Tag color="blue">DEV</Tag>}>
          Relances - DEV
        </Row>
        <span className="hp-muted hp-a5" style={{ fontSize: 9 }}>
          ↵ ouvrir
        </span>
      </div>
    </div>
  );
}

function Bulk() {
  return (
    <Frame title="Workflows">
      <Body>
        <Row right={<Tag color="blue">DEV</Tag>}>
          <Check className="hp-on1 hp-p1" /> Facturation - DEV
        </Row>
        <Row right={<Tag color="blue">DEV</Tag>}>
          <Check className="hp-on2 hp-p2" /> Relances - DEV
        </Row>
        <Row right={<Tag color="blue">DEV</Tag>}>
          <Check /> Devis - DEV
        </Row>
        <Row right={<Tag color="green">PROD</Tag>}>
          <Check /> Devis - PROD
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
          background: '#e6f4ff',
        }}
      >
        <b style={{ whiteSpace: 'nowrap' }}>2 sélectionnés</b>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <span className="hp-btn">Analyser</span>
          <span className="hp-btn">Archiver</span>
        </span>
      </div>
      <Cursor x1={20} y1={41} x2={20} y2={64} />
    </Frame>
  );
}

function Checks() {
  return (
    <Frame
      title="Contrôles à lancer"
      right={
        <Tag color="green" className="hp-a5">
          4 lancés
        </Tag>
      }
    >
      <Body style={{ gap: 0 }}>
        <Row>
          <Check on /> Structure
        </Row>
        <Row>
          <Check on /> Fiabilité
        </Row>
        <Row>
          <Check on className="hp-off1 hp-p1" /> Revue IA
        </Row>
        <Row>
          <Check on /> Code JS
        </Row>
        <Row>
          <Check on /> Naming
        </Row>
      </Body>
      <span className="hp-btn primary hp-abs hp-p2" style={{ right: 8, bottom: 8 }}>
        Lancer
      </span>
      <Cursor x1={20} y1={87} x2={268} y2={140} />
    </Frame>
  );
}

function FindingsFix() {
  return (
    <Frame title="Findings · Relances - DEV">
      <Body style={{ gap: 0 }}>
        <Row right={<span className="hp-btn hp-p1">✦ Corriger (IA)</span>}>
          <b>HTTP Stripe</b> <Tag color="red">1</Tag>
          <Tag color="orange">2</Tag>
        </Row>
        <Row>
          <span className="hp-ko">✕</span> Pas de timeout
        </Row>
        <Row>
          <span style={{ color: '#d46b08' }}>!</span> Pas de retry
        </Row>
        <Row>
          <span style={{ color: '#d46b08' }}>!</span> Erreur avalée
        </Row>
      </Body>
      <div className="hp-panel hp-a2" style={{ left: 110, right: 8, top: 50 }}>
        <b>Proposition</b>
        <span className="hp-diff add hp-a3">+ timeout: 10 s</span>
        <span className="hp-diff add hp-a3">+ retry: 3 fois</span>
        <span className="hp-diff add hp-a4">+ onError: stop</span>
        <span className="hp-a5" style={{ display: 'flex', gap: 4 }}>
          <span className="hp-btn primary">Appliquer</span>
          <span className="hp-btn">Voir le diff</span>
        </span>
      </div>
      <Cursor x1={250} y1={41} mode="one" />
    </Frame>
  );
}

function Ignore() {
  return (
    <Frame title="Findings">
      <Body style={{ gap: 0 }}>
        <Row className="hp-gone2" right={<span className="hp-btn hp-p1">Ignorer</span>}>
          <span style={{ color: '#d46b08' }}>!</span> Valeur d&apos;exemple · example.com
        </Row>
        <Row>
          <span style={{ color: '#d46b08' }}>!</span> Nœud sans nom
        </Row>
        <Row>
          <span className="hp-ko">✕</span> Référence vers un nœud absent
        </Row>
      </Body>
      <div className="hp-abs hp-a2" style={{ left: 120, right: 8, top: 44 }}>
        <div className="hp-panel hp-gone2" style={{ position: 'relative' }}>
          <b>Ignorer pour…</b>
          <span>○ ce workflow</span>
          <span>
            <b style={{ color: '#1677ff' }}>●</b> tous ses envs
          </span>
          <span>○ partout</span>
          <span style={{ alignSelf: 'flex-end' }} className="hp-btn primary hp-p2">
            Ignorer
          </span>
        </div>
      </div>
      <Tag color="green" className="hp-note hp-a5">
        Ignoré dans tous les envs
      </Tag>
      <Cursor x1={262} y1={41} x2={263} y2={130} />
    </Frame>
  );
}

function Stub() {
  return (
    <Frame title="Tester sans rien envoyer">
      <Body style={{ gap: 0 }}>
        <Row right={<span className="hp-muted">entrée</span>}>
          <Check /> Webhook
        </Row>
        <Row right={<Tag color="orange">sort</Tag>}>
          <Check on className="hp-a1" /> Gmail · envoyer
        </Row>
        <Row right={<Tag color="orange">sort</Tag>}>
          <Check on className="hp-a1" /> Slack · poster
        </Row>
        <Row right={<Tag color="orange">sort</Tag>}>
          <Check on className="hp-a1" /> HTTP POST · Stripe
        </Row>
      </Body>
      <Tag color="green" className="hp-note hp-a3">
        0 envoi réel · 3 bouchons
      </Tag>
      <span className="hp-btn primary hp-abs hp-p1" style={{ right: 8, bottom: 8 }}>
        Lancer l&apos;essai
      </span>
      <Cursor x1={255} y1={140} mode="one" />
    </Frame>
  );
}

function Remote() {
  return (
    <Frame title="Airtable · Clients" right={<span className="hp-btn hp-p1">Vérifier le distant</span>}>
      <Body style={{ gap: 0 }}>
        <Row right={<span className="hp-ok hp-a2">✓</span>}>Nom</Row>
        <Row right={<span className="hp-ok hp-a2">✓</span>}>Email</Row>
        <Row
          right={
            <Tag color="red" className="hp-a3">
              absente
            </Tag>
          }
        >
          Téléphone
        </Row>
        <Row right={<span className="hp-ok hp-a3">✓</span>}>Statut</Row>
      </Body>
      <Tag color="red" className="hp-note hp-a5">
        1 colonne manquante (Téléphone)
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
  return (
    <div className="hp-mw">
      <div className="hp-head">Relances - DEV</div>
      <MiniGraph glow />
      <div style={DRAWER}>
        <div className="hp-head">✦ Assistant IA</div>
        <div className="hp-bubble me hp-abs hp-a2" style={{ right: 8, top: 32, maxWidth: 150 }}>
          Ajoute un retry sur l&apos;appel HTTP
        </div>
        <div className="hp-bubble ai hp-abs hp-a3" style={{ left: 8, top: 70, width: 140 }}>
          Prêt : 1 nœud modifié
          <br />
          <span className="hp-muted">HTTP · 3 essais, 5 s</span>
        </div>
        <span className="hp-btn primary hp-abs hp-a3" style={{ left: 16, top: 112 }}>
          Appliquer
        </span>
        <Tag color="green" className="hp-abs hp-a4" style={{ left: 90, top: 116 }}>
          Appliqué
        </Tag>
        <div className="hp-input hp-abs" style={{ left: 6, right: 32, bottom: 6 }}>
          <span className="hp-gone1">
            <span className="hp-type1">Ajoute un retry sur l&apos;appel…</span>
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
  return (
    <div className="hp-mw">
      <div className="hp-head">Erreurs · Problèmes</div>
      <div className="hp-body">
        <div className="hp-panel" style={{ position: 'relative', boxShadow: 'none', width: 104 }}>
          <span>
            <span className="hp-dot red" style={{ display: 'inline-block' }} /> <b>401</b> <Tag>12×</Tag>
          </span>
          <span className="hp-muted">HTTP · Stripe</span>
          <span className="hp-btn hp-p1" style={{ fontSize: 8.5, padding: '0 5px' }}>
            ✦ Correctif IA
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
        <div className="hp-head">✦ Assistant IA</div>
        <div className="hp-bubble ai hp-abs hp-a3" style={{ left: 8, top: 34, width: 140 }}>
          <b>Credential Stripe expirée.</b>
        </div>
        <div className="hp-bubble ai hp-abs hp-a4" style={{ left: 8, top: 66, width: 140 }}>
          À renouveler dans n8n : rien à changer au workflow.
        </div>
      </div>
      <Cursor x1={60} y1={76} mode="one" />
    </div>
  );
}

function Promote() {
  return (
    <Frame title="Promouvoir · Facturation">
      <Body>
        <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <Tag color="blue">DEV</Tag>→<Tag>PREPROD</Tag>→<span className="hp-tag green hp-glow">PROD</span>
          <Tag className="hp-a5" color="green">
            1.3.0 en prod
          </Tag>
        </span>
        <span className="hp-a1">
          <span className="hp-ok">✓</span> Tests verts
        </span>
        <span className="hp-a2">
          <span className="hp-ok">✓</span> Aucun finding bloquant
        </span>
        <span className="hp-a3">
          <span className="hp-ok">✓</span> Colonnes distantes présentes
        </span>
        <span className="hp-a3">
          Version <span className="hp-muted">1.2.0 →</span> <b>1.3.0</b>
        </span>
      </Body>
      <span className="hp-btn primary hp-abs hp-p2" style={{ right: 8, bottom: 8 }}>
        Promouvoir
      </span>
      <Cursor x2={262} y2={140} mode="late" />
    </Frame>
  );
}

function Mapping() {
  const swap = (before: React.ReactNode, after: React.ReactNode, step: string) => (
    <span style={{ position: 'relative', display: 'inline-block', minWidth: 150 }}>
      <span className="hp-gone1">{before}</span>
      <span className={cls('hp-abs', step)} style={{ left: 0, top: 0 }}>
        {after}
      </span>
    </span>
  );
  return (
    <Frame title="Nœud Airtable" right={<Tag color="blue">DEV</Tag>}>
      <Body style={{ gap: 7 }}>
        <span>
          <span className="hp-muted">Base </span>
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
          <span className="hp-muted">Table </span>
          {swap(<b>Prospects (dev)</b>, <b>Prospects (prod)</b>, 'hp-a3')}
        </span>
        <span>
          <span className="hp-muted">Credential </span>
          {swap(<b>Airtable dev</b>, <b>Airtable prod</b>, 'hp-a4')}
        </span>
      </Body>
      <Tag color="green" className="hp-note hp-a5">
        3 bascules · ids et noms
      </Tag>
      <span className="hp-btn primary hp-abs hp-p1" style={{ right: 8, bottom: 8 }}>
        Basculer vers PROD
      </span>
      <Cursor x1={250} y1={140} mode="one" />
    </Frame>
  );
}

function Errors() {
  return (
    <Frame title="Erreurs">
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
        <span className="hp-muted">1 problème, 3 exécutions</span>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span className="hp-btn hp-p2">Traité</span>
          <Tag color="green" className="hp-a4">
            traité
          </Tag>
        </span>
        <Tag color="orange" className="hp-a5">
          rouvert · 1 rechute
        </Tag>
      </div>
      <Cursor x2={172} y2={82} mode="late" />
    </Frame>
  );
}

function Drift() {
  const bars = [30, 34, 28, 32, 36, 31, 33, 29, 52, 58, 61];
  return (
    <Frame
      title="Performance · Relances - PROD"
      right={
        <Tag color="red" className="hp-a4">
          durée ×1,8
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
            style={{ flex: 1, height: h * 1.4, borderRadius: 3, background: i >= 8 ? '#ff7875' : '#91caff' }}
          />
        ))}
      </div>
      <div className="hp-panel hp-a5" style={{ right: 10, top: 32, width: 150 }}>
        <b># alertes</b>
        <span>Relances ralentit : ×1,8 vs semaine passée</span>
      </div>
    </Frame>
  );
}

function Costs() {
  const rows: Array<[string, number]> = [
    ['Tri des mails', 62],
    ['Résumé tickets', 38],
    ['Devis IA', 21],
  ];
  return (
    <Frame title="Coûts IA · aujourd'hui" right={<b className="hp-a4">5,40 $</b>}>
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
        Budget du jour dépassé (5 $)
      </Tag>
    </Frame>
  );
}

function Restore() {
  return (
    <Frame title="Versions · Facturation">
      <Body style={{ gap: 0 }}>
        <Row right={<Tag color="blue">courante</Tag>}>
          <b>v14</b> <span className="hp-muted">aujourd&apos;hui</span>
        </Row>
        <Row>
          <b>v13</b> <span className="hp-muted">hier</span>
        </Row>
        <Row right={<span className="hp-btn hp-p1">Restaurer</span>}>
          <b>v12</b> <span className="hp-muted">lundi</span>
        </Row>
      </Body>
      <div className="hp-abs hp-a2" style={{ left: 96, right: 8, top: 40 }}>
        <div className="hp-panel hp-gone2" style={{ position: 'relative' }}>
          <b>Revenir à v12 ?</b>
          <span className="hp-diff del">− Slack · #finance</span>
          <span className="hp-diff add">+ Slack · #compta</span>
          <span style={{ alignSelf: 'flex-end' }} className="hp-btn primary hp-p2">
            Restaurer
          </span>
        </div>
      </div>
      <Tag color="green" className="hp-note hp-a5">
        v15 · restaurée depuis v12
      </Tag>
      <Cursor x1={262} y1={87} x2={260} y2={117} />
    </Frame>
  );
}

function Resources() {
  return (
    <Frame title="Ressources externes">
      <Body>
        <span className="hp-input">
          <span className="hp-muted">⌕</span>
          <span className="hp-type1">crm</span>
        </span>
        <b className="hp-a2">Airtable · CRM · Prospects</b>
        <Row className="hp-a3" right={<span className="hp-muted">écrit Nom, Email</span>}>
          Facturation - PROD
        </Row>
        <Row className="hp-a4" right={<span className="hp-muted">lit tout</span>}>
          Relances - PROD
        </Row>
        <Row className="hp-a5" right={<Tag color="orange">à rouvrir</Tag>}>
          Devis - PROD
        </Row>
      </Body>
    </Frame>
  );
}

function ListMemory() {
  return (
    <Frame title="Workflows">
      <Body>
        <Row right={<span className="hp-muted hp-p1">⚙</span>}>
          <span className="hp-muted">Nom</span>
          <span className="hp-muted" style={{ marginLeft: 70 }}>
            Env
          </span>
          <span className="hp-muted hp-gone2" style={{ marginLeft: 22 }}>
            Tags
          </span>
        </Row>
        <Row right={<Tag color="green">PROD</Tag>}>Facturation</Row>
        <Row right={<Tag color="green">PROD</Tag>}>Relances</Row>
      </Body>
      <div className="hp-panel hp-a2" style={{ right: 8, top: 44, width: 110 }}>
        <span>
          <Check on /> Nom
        </span>
        <span>
          <Check on /> Env
        </span>
        <span>
          <Check on className="hp-p2" /> Tags
        </span>
      </div>
      <div className="hp-abs hp-a4" style={{ left: 14, bottom: 10 }}>
        <span className="hp-muted">Retrouvée telle quelle au retour</span>
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
