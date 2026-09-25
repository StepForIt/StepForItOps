'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Space, Tooltip } from 'antd';
import {
  CompressOutlined,
  ExpandOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const DRAG_THRESHOLD = 4; // px — en deçà, on considère que c'est un clic, pas un déplacement

const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

const SVG_NS = 'http://www.w3.org/2000/svg';
const START_DOT_RADIUS = 4;

/**
 * Disque à la base de chaque flèche, couleur du trait. `getPointAtLength(0)` du tracé plutôt que
 * la position du nœud : seul point juste quel que soit le routage — et posé dans le groupe du
 * tracé, donc sans conversion de coordonnées.
 */
function drawStartDots(svg: SVGElement): void {
  svg.querySelectorAll<SVGPathElement>('path.flowchart-link').forEach((path) => {
    if (!path.getTotalLength()) return;
    const start = path.getPointAtLength(0);
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(start.x));
    dot.setAttribute('cy', String(start.y));
    dot.setAttribute('r', String(START_DOT_RADIUS));
    dot.setAttribute('fill', getComputedStyle(path).stroke);
    path.parentNode?.appendChild(dot);
  });
}

/**
 * Rendu Mermaid côté client, avec zoom (CSS `transform` : SVG net à tout niveau) et déplacement.
 *
 * `interactive` autorise les `click ... href` (ignorés en `strict`) mais reste en `antiscript` :
 * un diagramme écrit par l'IA ne doit pas pouvoir exécuter de script — d'où le défaut `strict`
 * pour les autres appelants. `layout: 'elk'` évite les croisements de flèches du `dagre` par
 * défaut sur les graphes larges. `startDots` marque le départ des flèches après coup sur le SVG :
 * mermaid n'a pas de type de lien « rond au départ, pointe à l'arrivée ».
 */
export function MermaidView({
  code,
  interactive = false,
  height = 520,
  layout = 'dagre',
  startDots = false,
}: {
  code: string;
  interactive?: boolean;
  height?: number;
  layout?: 'dagre' | 'elk';
  startDots?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const fit = useCallback(() => {
    const viewport = viewportRef.current;
    const svg = contentRef.current?.querySelector('svg');
    if (!viewport || !svg) return;
    const box = svg.getBoundingClientRect();
    const natural = {
      width: box.width / transform.scale,
      height: box.height / transform.scale,
    };
    if (!natural.width || !natural.height) return;
    const scale = clamp(
      Math.min((viewport.clientWidth - 32) / natural.width, (viewport.clientHeight - 32) / natural.height, 1),
    );
    setTransform({
      scale,
      x: (viewport.clientWidth - natural.width * scale) / 2,
      y: (viewport.clientHeight - natural.height * scale) / 2,
    });
  }, [transform.scale]);

  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import('mermaid')).default;
      if (layout === 'elk') {
        // Version épinglée en 0.1.x : la 0.2 sérialise le graphe en JSON pour une trace de
        // débogage laissée dans le code, et plante (« circular structure ») dès qu'un libellé
        // porte un élément du DOM — c'est-à-dire toujours.
        const elk = (await import('@mermaid-js/layout-elk')).default;
        mermaid.registerLayoutLoaders(elk);
      }
      mermaid.initialize({
        startOnLoad: false,
        theme: 'neutral',
        securityLevel: interactive ? 'antiscript' : 'strict',
        layout,
        // De l'air entre les boîtes : c'est là que le routeur fait passer les flèches longues.
        flowchart: { nodeSpacing: 40, rankSpacing: 80 },
        // BRANDES_KOEPF aligne les boîtes d'un même rang ; `mergeEdges: false` garde une
        // flèche par lien plutôt qu'un tronc commun, plus facile à suivre quand ça se croise.
        elk: { nodePlacementStrategy: 'BRANDES_KOEPF', mergeEdges: false },
      });
      try {
        const { svg } = await mermaid.render(`mmd-${Date.now()}`, code);
        if (cancelled || !contentRef.current) return;
        contentRef.current.innerHTML = svg;
        // Le SVG élastique de mermaid (`width: 100%`) se réduit à rien dans un conteneur
        // transformé : on le fige à la taille de son `viewBox`, le zoom fait le reste.
        const rendered = contentRef.current.querySelector('svg');
        const viewBox = rendered
          ?.getAttribute('viewBox')
          ?.split(/[\s,]+/)
          .map(Number);
        if (rendered && viewBox?.length === 4) {
          rendered.style.maxWidth = 'none';
          rendered.style.width = `${viewBox[2]}px`;
          rendered.style.height = `${viewBox[3]}px`;
        }
        if (rendered && startDots) drawStartDots(rendered);
        setTransform({ scale: 1, x: 0, y: 0 });
        requestAnimationFrame(() => {
          if (!cancelled) fitRef.current();
        });
      } catch (error) {
        if (!cancelled && contentRef.current) {
          contentRef.current.innerHTML = `<pre>${(error as Error).message}\n\n${code}</pre>`;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `fit` dépend de l'échelle courante : on passe par une ref pour ne pas relancer le rendu.
  }, [code, interactive, layout, startDots]);

  // Le zoom à la molette doit pouvoir annuler le défilement de la page : listener non passif.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setTransform((current) => {
        const scale = clamp(current.scale * Math.exp(-event.deltaY / 500));
        const ratio = scale / current.scale;
        return {
          scale,
          x: pointer.x - (pointer.x - current.x) * ratio,
          y: pointer.y - (pointer.y - current.y) * ratio,
        };
      });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // Déplacement à la souris. Les écouteurs vivent sur la fenêtre (et non sur le viewport, sans
  // capture de pointeur) pour que les liens du diagramme `interactive` restent cliquables :
  // tant qu'on n'a pas franchi le seuil, le geste reste un clic ordinaire.
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const origin = { x: event.clientX, y: event.clientY };
    const start = { ...transform };
    let moved = false;

    const onMove = (move: PointerEvent) => {
      const dx = move.clientX - origin.x;
      const dy = move.clientY - origin.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        setDragging(true);
      }
      setTransform({ scale: start.scale, x: start.x + dx, y: start.y + dy });
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /** Zoom par bouton : on garde le centre de la fenêtre comme point fixe. */
  const zoomBy = (factor: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const center = { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 };
    setTransform((current) => {
      const scale = clamp(current.scale * factor);
      const ratio = scale / current.scale;
      return {
        scale,
        x: center.x - (center.x - current.x) * ratio,
        y: center.y - (center.y - current.y) * ratio,
      };
    });
  };

  return (
    <div
      style={
        fullscreen
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
            }
          : { position: 'relative' }
      }
    >
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 2,
          background: 'rgba(255, 255, 255, 0.9)',
          borderRadius: 6,
          padding: 2,
        }}
      >
        <Space size={2}>
          <Tooltip title="Zoom arrière">
            <Button size="small" icon={<ZoomOutOutlined />} onClick={() => zoomBy(1 / 1.25)} />
          </Tooltip>
          <span style={{ minWidth: 44, textAlign: 'center', fontSize: 12, color: '#8c8c8c' }}>
            {Math.round(transform.scale * 100)} %
          </span>
          <Tooltip title="Zoom avant">
            <Button size="small" icon={<ZoomInOutlined />} onClick={() => zoomBy(1.25)} />
          </Tooltip>
          <Tooltip title="Ajuster">
            <Button size="small" icon={<CompressOutlined />} onClick={fit} />
          </Tooltip>
          <Tooltip title="Taille réelle">
            <Button
              size="small"
              icon={<ExpandOutlined />}
              onClick={() => setTransform({ scale: 1, x: 0, y: 0 })}
            />
          </Tooltip>
          <Tooltip title={fullscreen ? 'Quitter le plein écran' : 'Plein écran'}>
            <Button
              size="small"
              icon={fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={() => {
                setFullscreen((value) => !value);
                requestAnimationFrame(() => fitRef.current());
              }}
            />
          </Tooltip>
        </Space>
      </div>

      <div
        ref={viewportRef}
        onPointerDown={onPointerDown}
        style={{
          flex: fullscreen ? 1 : undefined,
          height: fullscreen ? undefined : height,
          overflow: 'hidden',
          background: '#fff',
          border: '1px solid #f0f0f0',
          borderRadius: fullscreen ? 0 : 8,
          cursor: dragging ? 'grabbing' : 'grab',
          touchAction: 'none',
        }}
      >
        <div
          ref={contentRef}
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transformOrigin: '0 0',
            width: 'max-content',
          }}
        />
      </div>
    </div>
  );
}
