'use client';

import React from 'react';

/**
 * Rendu Markdown minimal sans dépendance, couvrant ce que produit l'IA. Volontairement strict :
 * tout ce qui n'est pas reconnu reste du texte, le HTML brut n'est jamais interprété.
 */

const HEADING_SIZES = ['1.35em', '1.2em', '1.1em', '1em', '1em', '1em'];

/** Seuls les schémas sûrs sont cliquables (jamais `javascript:`). */
function safeHref(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

const INLINE_PATTERN =
  /`([^`]+)`|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+)\*|(?<![\w_])_([^_\n]+)_(?![\w_])|~~([\s\S]+?)~~|\[([^\]]*)\]\(([^)\s]+)\)/g;

/** Applique les marques inline (récursif : du gras peut contenir de l'italique). */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = new RegExp(INLINE_PATTERN.source, 'g');
  let cursor = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  const push = (node: React.ReactNode) => nodes.push(node);

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) push(text.slice(cursor, match.index));
    const key = `${keyPrefix}-${index++}`;
    const [, code, boldStar, boldUnderscore, italicStar, italicUnderscore, strike, linkText, linkUrl] = match;

    if (code !== undefined) {
      push(
        <code
          key={key}
          style={{ background: '#f0f0f0', borderRadius: 4, padding: '0 4px', fontSize: '0.92em' }}
        >
          {code}
        </code>,
      );
    } else if (boldStar !== undefined || boldUnderscore !== undefined) {
      push(<strong key={key}>{renderInline(boldStar ?? boldUnderscore, key)}</strong>);
    } else if (italicStar !== undefined || italicUnderscore !== undefined) {
      push(<em key={key}>{renderInline(italicStar ?? italicUnderscore, key)}</em>);
    } else if (strike !== undefined) {
      push(<del key={key}>{renderInline(strike, key)}</del>);
    } else {
      const href = safeHref(linkUrl);
      const label = renderInline(linkText || linkUrl, key);
      push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) push(text.slice(cursor));
  return nodes;
}

/** Texte d'un paragraphe : les retours à la ligne simples sont conservés. */
function renderParagraphText(lines: string[], keyPrefix: string): React.ReactNode[] {
  return lines.flatMap((line, i) => [
    ...(i > 0 ? [<br key={`${keyPrefix}-br-${i}`} />] : []),
    ...renderInline(line, `${keyPrefix}-${i}`),
  ]);
}

interface ListItem {
  indent: number;
  ordered: boolean;
  lines: string[];
}

const BULLET_RE = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const RULE_RE = /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/;
const FENCE_RE = /^\s*```(\w*)\s*$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;
/**
 * Repli : `:::détail <résumé>` … `:::`. L'assistant y range ce qui dépasse du corps du
 * message — raisonnement, listes de champs, périmètre — et seul le résumé reste à l'écran.
 */
const DETAILS_OPEN_RE = /^\s*:::\s*(?:détail|detail|details)?\s*(.*?)\s*$/;
const DETAILS_CLOSE_RE = /^\s*:::\s*$/;

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().endsWith('|') && line.includes('|');
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/** Reconstruit l'imbrication des listes depuis l'indentation des items. */
function renderList(items: ListItem[], keyPrefix: string): React.ReactNode {
  const baseIndent = items[0].indent;
  const ordered = items[0].ordered;
  const children: React.ReactNode[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index];
    const nested: ListItem[] = [];
    index += 1;
    while (index < items.length && items[index].indent > baseIndent) {
      nested.push(items[index]);
      index += 1;
    }
    const key = `${keyPrefix}-li-${children.length}`;
    children.push(
      <li key={key} style={{ margin: '2px 0' }}>
        {renderParagraphText(item.lines, key)}
        {nested.length > 0 && renderList(nested, key)}
      </li>,
    );
  }

  const style: React.CSSProperties = { margin: '4px 0', paddingLeft: 20 };
  return ordered ? (
    <ol key={keyPrefix} style={style}>
      {children}
    </ol>
  ) : (
    <ul key={keyPrefix} style={style}>
      {children}
    </ul>
  );
}

/** Bloc replié : le résumé reste lisible, le détail ne s'ouvre que si on le demande. */
function Details({ summary, body }: { summary: string; body: string }) {
  return (
    <details style={{ margin: '6px 0', border: '1px solid #f0f0f0', borderRadius: 6, padding: '4px 8px' }}>
      <summary style={{ cursor: 'pointer', color: '#595959' }}>{renderInline(summary, 'summary')}</summary>
      <div style={{ marginTop: 6 }}>{parseBlocks(body)}</div>
    </details>
  );
}

function parseBlocks(source: string): React.ReactNode[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let cursor = 0;
  let blockIndex = 0;
  const nextKey = () => `b${blockIndex++}`;

  while (cursor < lines.length) {
    const line = lines[cursor];

    if (!line.trim()) {
      cursor += 1;
      continue;
    }

    if (DETAILS_OPEN_RE.test(line) && !DETAILS_CLOSE_RE.test(line)) {
      const summary = DETAILS_OPEN_RE.exec(line)![1];
      const body: string[] = [];
      cursor += 1;
      while (cursor < lines.length && !DETAILS_CLOSE_RE.test(lines[cursor])) {
        body.push(lines[cursor]);
        cursor += 1;
      }
      cursor += 1; // marqueur fermant (ou fin de texte)
      blocks.push(<Details key={nextKey()} summary={summary || 'Détail'} body={body.join('\n')} />);
      continue;
    }

    // Marqueur fermant orphelin : rien à afficher, surtout pas trois deux-points.
    if (DETAILS_CLOSE_RE.test(line)) {
      cursor += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      cursor += 1;
      while (cursor < lines.length && !FENCE_RE.test(lines[cursor])) {
        body.push(lines[cursor]);
        cursor += 1;
      }
      cursor += 1; // fence fermante (ou fin de texte)
      blocks.push(
        <pre
          key={nextKey()}
          style={{
            background: '#f6f6f6',
            padding: 8,
            borderRadius: 6,
            overflowX: 'auto',
            fontSize: '0.92em',
            margin: '8px 0',
          }}
        >
          {body.join('\n')}
        </pre>,
      );
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      const key = nextKey();
      blocks.push(
        <div
          key={key}
          style={{
            fontWeight: 600,
            fontSize: HEADING_SIZES[level - 1],
            margin: blocks.length === 0 ? '0 0 4px' : '10px 0 4px',
          }}
        >
          {renderInline(heading[2], key)}
        </div>,
      );
      cursor += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push(
        <hr key={nextKey()} style={{ border: 0, borderTop: '1px solid #f0f0f0', margin: '10px 0' }} />,
      );
      cursor += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (cursor < lines.length && QUOTE_RE.test(lines[cursor])) {
        quoted.push(QUOTE_RE.exec(lines[cursor])![1]);
        cursor += 1;
      }
      const key = nextKey();
      blocks.push(
        <blockquote
          key={key}
          style={{
            margin: '6px 0',
            padding: '2px 0 2px 10px',
            borderLeft: '3px solid #d9d9d9',
            color: '#595959',
          }}
        >
          {renderParagraphText(quoted, key)}
        </blockquote>,
      );
      continue;
    }

    if (isTableRow(line) && cursor + 1 < lines.length && TABLE_SEP_RE.test(lines[cursor + 1])) {
      const header = tableCells(line);
      cursor += 2;
      const rows: string[][] = [];
      while (cursor < lines.length && isTableRow(lines[cursor])) {
        rows.push(tableCells(lines[cursor]));
        cursor += 1;
      }
      const key = nextKey();
      const cellStyle: React.CSSProperties = {
        border: '1px solid #f0f0f0',
        padding: '3px 6px',
        textAlign: 'left',
      };
      blocks.push(
        <div key={key} style={{ overflowX: 'auto', margin: '8px 0' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: '0.95em' }}>
            <thead>
              <tr>
                {header.map((cell, i) => (
                  <th key={i} style={{ ...cellStyle, background: '#fafafa' }}>
                    {renderInline(cell, `${key}-h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={cellStyle}>
                      {renderInline(cell, `${key}-${r}-${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (BULLET_RE.test(line) || ORDERED_RE.test(line)) {
      const items: ListItem[] = [];
      while (cursor < lines.length) {
        const current = lines[cursor];
        const bullet = BULLET_RE.exec(current);
        const ordered = bullet ? null : ORDERED_RE.exec(current);
        if (bullet || ordered) {
          const match = (bullet ?? ordered)!;
          items.push({ indent: match[1].length, ordered: Boolean(ordered), lines: [match[3]] });
          cursor += 1;
          continue;
        }
        // Continuation d'item : ligne indentée qui n'ouvre pas un nouvel item.
        if (items.length > 0 && current.trim() && /^\s+/.test(current)) {
          items[items.length - 1].lines.push(current.trim());
          cursor += 1;
          continue;
        }
        break;
      }
      blocks.push(renderList(items, nextKey()));
      continue;
    }

    const paragraph: string[] = [];
    while (cursor < lines.length) {
      const current = lines[cursor];
      if (
        !current.trim() ||
        FENCE_RE.test(current) ||
        HEADING_RE.test(current) ||
        RULE_RE.test(current) ||
        DETAILS_OPEN_RE.test(current) ||
        QUOTE_RE.test(current) ||
        BULLET_RE.test(current) ||
        ORDERED_RE.test(current) ||
        isTableRow(current)
      ) {
        break;
      }
      paragraph.push(current);
      cursor += 1;
    }
    const key = nextKey();
    blocks.push(
      <p key={key} style={{ margin: blocks.length === 0 ? '0 0 6px' : '6px 0' }}>
        {renderParagraphText(paragraph, key)}
      </p>,
    );
  }

  return blocks;
}

export function Markdown({ content, style }: { content: string; style?: React.CSSProperties }) {
  const blocks = React.useMemo(() => parseBlocks(content), [content]);
  return <div style={{ wordBreak: 'break-word', ...style }}>{blocks}</div>;
}
