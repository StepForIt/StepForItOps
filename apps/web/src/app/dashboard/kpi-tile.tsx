import Link from 'next/link';
import type { ReactNode } from 'react';

export type KpiTone = 'lagon' | 'corail' | 'ambre' | 'roi' | 'marine';

/** Une tuile d'indicateur : filet de la couleur de son sens, chiffre dans la police des titres. */
export function KpiTile({
  label,
  value,
  tone,
  href,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone: KpiTone;
  href?: string;
  hint?: string;
}) {
  const body = (
    <>
      <div className="dash-kpi-label">{label}</div>
      <div className="dash-kpi-value">{value}</div>
      {hint && <div className="dash-kpi-hint">{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className={`dash-kpi dash-kpi-${tone}`}>
      {body}
    </Link>
  ) : (
    <div className={`dash-kpi dash-kpi-${tone}`}>{body}</div>
  );
}
