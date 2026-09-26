import React from 'react';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTimeZone, getTranslations } from 'next-intl/server';
import { Familjen_Grotesk, Inter } from 'next/font/google';
import { RefineApp } from './refine-app';
import { PwaRegister } from '../components/pwa-register';
import './globals.css';
import './design-system.css';
import { BRAND_CSS_VARS } from '../lib/brand/theme';

// Les polices de la charte, servies par l'app elle-même (next/font les télécharge au
// build) : aucune requête vers Google au chargement d'un écran.
const text = Inter({ subsets: ['latin', 'latin-ext'], variable: '--font-text', display: 'swap' });
const display = Familjen_Grotesk({
  subsets: ['latin', 'latin-ext'],
  weight: ['600', '700'],
  variable: '--font-display',
  display: 'swap',
});

// L'app est une console d'admin branchée sur l'API : pas de prerender statique.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app');
  return { ...METADATA, title: t('title'), description: t('description') };
}

const METADATA = {
  // Installation : manifeste + icônes servis depuis public/ (cf. middleware,
  // qui les laisse passer sans session — le navigateur va chercher le
  // manifeste sans cookie).
  manifest: '/manifest.webmanifest',
  applicationName: 'StepForIt Ops',
  appleWebApp: { capable: true, title: 'StepForIt Ops', statusBarStyle: 'default' as const },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#06182D',
  // Fenêtre installée sur mobile : le contenu occupe l'écran, encoches comprises.
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages, timeZone] = await Promise.all([getLocale(), getMessages(), getTimeZone()]);
  return (
    <html lang={locale} className={`${text.variable} ${display.variable}`}>
      <head>
        {/* Les couleurs de la charte en variables CSS, depuis `lib/brand/` : design-system.css les lit. */}
        <style dangerouslySetInnerHTML={{ __html: BRAND_CSS_VARS }} />
      </head>
      <body style={{ margin: 0 }}>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
          <PwaRegister />
          <RefineApp>{children}</RefineApp>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
