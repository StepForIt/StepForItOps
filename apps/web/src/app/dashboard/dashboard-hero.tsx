import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BRAND } from '../../lib/brand/colors';
import { NodeMotif } from './node-motif';

export interface HeroSignal {
  href: string;
  label: string;
  tone: 'corail' | 'ambre';
}

export interface HeroFigure {
  value: string;
  label: string;
  tone: 'roi' | 'craie';
  href?: string;
}

/**
 * Le bandeau du tableau de bord, en aplat nuit : ce qui a bougé depuis la dernière
 * visite à gauche, ce que la plateforme rapporte à droite.
 */
export function DashboardHero({
  since,
  signals,
  figures,
}: {
  since: string;
  signals: HeroSignal[];
  figures: HeroFigure[];
}) {
  const t = useTranslations('misc.home.hero');
  return (
    <section className="dash-hero">
      <NodeMotif />
      <div className="dash-hero-main">
        <div className="dash-hero-kicker">{since}</div>
        {signals.length === 0 ? (
          <div className="dash-hero-title">
            {t('allGood')}
            <span style={{ color: BRAND.lagon }}>.</span>
          </div>
        ) : (
          <>
            <div className="dash-hero-title">{t('toLook')}</div>
            <div className="dash-hero-signals">
              {signals.map((signal) => (
                <Link
                  key={signal.label}
                  href={signal.href}
                  className={`dash-signal dash-signal-${signal.tone}`}
                >
                  {signal.label}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="dash-hero-figures">
        {figures.map((figure) => {
          const body = (
            <>
              <div className={`dash-figure-value dash-figure-${figure.tone}`}>{figure.value}</div>
              <div className="dash-figure-label">{figure.label}</div>
            </>
          );
          return figure.href ? (
            <Link key={figure.label} href={figure.href} className="dash-figure">
              {body}
            </Link>
          ) : (
            <div key={figure.label} className="dash-figure">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}
