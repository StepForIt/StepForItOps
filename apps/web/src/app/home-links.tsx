import React from 'react';
import Link from 'next/link';
import { Card, Col, Row } from 'antd';
import { useTranslations } from 'next-intl';

// Titre et texte : `misc.homeLinks.<key>`.
const SECTIONS = [
  { href: '/instances', key: 'instances' },
  { href: '/workflows', key: 'workflows' },
  { href: '/versions', key: 'versions' },
  { href: '/errors', key: 'errors' },
  { href: '/performance', key: 'performance' },
  { href: '/modules', key: 'modules' },
] as const;

/** Grille de raccourcis : la home historique, reléguée sous le dashboard (ou seule s'il est désactivé). */
export function HomeLinks() {
  const t = useTranslations('misc.homeLinks');
  return (
    <Row gutter={[16, 16]}>
      {SECTIONS.map((section) => (
        <Col xs={24} sm={12} lg={8} key={section.href}>
          <Link href={section.href}>
            <Card hoverable size="small" title={t(`${section.key}.title`)}>
              {t(`${section.key}.text`)}
            </Card>
          </Link>
        </Col>
      ))}
    </Row>
  );
}
