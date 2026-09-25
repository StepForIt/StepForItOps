import React from 'react';
import Link from 'next/link';
import { Card, Col, Row } from 'antd';

const SECTIONS = [
  { href: '/instances', title: 'Instances', text: 'Connecter vos instances n8n et vos comptes Make' },
  { href: '/workflows', title: 'Workflows', text: 'Synchroniser, vérifier, documenter, optimiser' },
  { href: '/versions', title: 'Versions', text: 'Historique + export GitHub / Google Drive' },
  { href: '/errors', title: 'Erreurs', text: 'Problèmes regroupés, rechutes, catégories' },
  { href: '/performance', title: 'Performance', text: 'Durées, taux de succès, dérives' },
  { href: '/modules', title: 'Modules', text: 'Activer / désactiver les fonctionnalités' },
];

/** Grille de raccourcis : la home historique, reléguée sous le dashboard (ou seule s'il est désactivé). */
export function HomeLinks() {
  return (
    <Row gutter={[16, 16]}>
      {SECTIONS.map((section) => (
        <Col xs={24} sm={12} lg={8} key={section.href}>
          <Link href={section.href}>
            <Card hoverable size="small" title={section.title}>
              {section.text}
            </Card>
          </Link>
        </Col>
      ))}
    </Row>
  );
}
