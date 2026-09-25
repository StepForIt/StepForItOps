'use client';

import React from 'react';
import { SCENES } from './tip-scenes';

const STAGE_WIDTH = 320;

/** La scène a une taille fixe : c'est l'échelle qui suit le cadre, jamais la mise en page. */
export function TipVignette({ id, still }: { id: string; still?: boolean }) {
  const frame = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / STAGE_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const Scene = SCENES[id];
  return (
    <div className="hp-frame" ref={frame} aria-hidden="true">
      <div className={`hp-stage${still ? ' hp-still' : ''}`} style={{ transform: `scale(${scale})` }}>
        {Scene && <Scene />}
      </div>
    </div>
  );
}
