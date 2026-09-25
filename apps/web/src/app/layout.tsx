import React from 'react';
import type { Viewport } from 'next';
import { RefineApp } from './refine-app';
import { PwaRegister } from '../components/pwa-register';
import './globals.css';

// L'app est une console d'admin branchée sur l'API : pas de prerender statique.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'StepForIt Ops',
  description: 'Versioning, vérification et monitoring de workflows n8n',
  // Installation : manifeste + icônes servis depuis public/ (cf. middleware,
  // qui les laisse passer sans session — le navigateur va chercher le
  // manifeste sans cookie).
  manifest: '/manifest.webmanifest',
  applicationName: 'StepForIt Ops',
  appleWebApp: { capable: true, title: 'StepForIt Ops', statusBarStyle: 'default' as const },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#1677ff',
  // Fenêtre installée sur mobile : le contenu occupe l'écran, encoches comprises.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>
        <PwaRegister />
        <RefineApp>{children}</RefineApp>
      </body>
    </html>
  );
}
