import { redirect } from 'next/navigation';

/**
 * Page Dépendances supprimée : remplacée par la carte des workflows et Ressources externes.
 */
export default function DepGraphRedirect() {
  redirect('/resources');
}
