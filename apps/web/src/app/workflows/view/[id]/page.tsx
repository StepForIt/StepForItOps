import { redirect } from 'next/navigation';

/**
 * La vue d'un workflow (schéma, inventaire) vivait ici, à part de sa fiche : on
 * quittait la fiche pour regarder le workflow, et les findings s'affichaient
 * des deux côtés. Ce sont désormais deux onglets de la fiche ; cette route est
 * gardée pour les liens déjà partagés et les favoris.
 */
export default function WorkflowViewRedirect({ params }: { params: { id: string } }) {
  redirect(`/workflows/show/${params.id}?tab=graph`);
}
