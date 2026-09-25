'use client';

import React from 'react';
import { Input, Typography } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { CompletionSources, completeDraft } from '../lib/chat-completion';

/**
 * Métriques de la zone de saisie antd, recopiées sur le calque de suggestion.
 * Le fantôme doit tomber au pixel sur le texte réel : une police ou un padding
 * qui diffère décale la suggestion d'un caractère et la rend illisible.
 */
const TEXT_STYLE: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5714285714285714,
  fontFamily: 'inherit',
  padding: '4px 11px',
  border: '1px solid transparent',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/**
 * La saisie du chat, avec la fin de phrase proposée en gris derrière le curseur
 * et acceptée par Tab.
 *
 * Le calque est POSÉ SUR la zone de saisie (`pointerEvents: none`) et la partie
 * déjà tapée y est transparente : c'est le vrai texte qu'on lit dessous, et le
 * curseur reste celui du champ. L'inverse — un fantôme dessous — obligerait à
 * rendre la zone transparente, et le fond de la carte remonterait au travers.
 */
export function ChatGhostInput({
  value,
  onChange,
  onSubmit,
  sources,
  disabled,
  placeholder,
  onFiles,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  sources: CompletionSources;
  disabled?: boolean;
  placeholder?: string;
  /** Captures collées ou déposées dans la zone : traitées par l'appelant. */
  onFiles: (files: File[]) => void;
}) {
  const [focused, setFocused] = React.useState(false);
  const [scrollTop, setScrollTop] = React.useState(0);
  const area = React.useRef<TextAreaRef>(null);

  // Hors focus, la suggestion n'est acceptable par aucune touche : l'afficher
  // ferait lire une phrase que personne ne peut prendre.
  const suggestion = React.useMemo(
    () => (focused ? completeDraft(value, sources) : null),
    [focused, value, sources],
  );

  return (
    // `flex: 1` : la saisie est un enfant de `Space.Compact`, qui range ses
    // éléments en ligne — sans quoi elle se réduirait à son contenu.
    <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <Input.TextArea
        ref={area}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Le calque ne défile pas avec le champ : sans ce report, la suggestion
        // reste collée en haut dès que le message dépasse la hauteur visible.
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onKeyDown={(event) => {
          if (event.key === 'Tab' && suggestion) {
            // Tab sort du champ par défaut : ici il écrit, et ne doit pas faire
            // les deux.
            event.preventDefault();
            onChange(value + suggestion);
          }
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (files.length > 0) {
            event.preventDefault();
            onFiles(files);
          }
        }}
        onDrop={(event) => {
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) {
            event.preventDefault();
            onFiles(files);
          }
        }}
        onPressEnter={(event) => {
          if (!event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        autoSize={{ minRows: 2, maxRows: 6 }}
        placeholder={placeholder}
        disabled={disabled}
        style={{ ...TEXT_STYLE, position: 'relative' }}
      />
      {suggestion && (
        <div
          aria-hidden
          style={{
            ...TEXT_STYLE,
            position: 'absolute',
            inset: 0,
            overflow: 'hidden',
            pointerEvents: 'none',
            // Au-dessus de la zone de saisie, que `Space.Compact` remonte à 3
            // dès qu'elle a le focus : sans ce cran, le fantôme est calculé,
            // posé au bon pixel — et peint DERRIÈRE le fond blanc du champ.
            zIndex: 4,
            color: 'transparent',
          }}
        >
          <div style={{ transform: `translateY(${-scrollTop}px)` }}>
            {value}
            <span style={{ color: '#bfbfbf' }}>{suggestion}</span>
            {/* Rappel discret de la touche, sur la même ligne que la suggestion :
                une aide qu'il faut deviner n'est utilisée par personne. */}
            <Typography.Text
              type="secondary"
              style={{ fontSize: 11, marginInlineStart: 6, whiteSpace: 'nowrap' }}
            >
              ⇥ Tab
            </Typography.Text>
          </div>
        </div>
      )}
    </div>
  );
}
