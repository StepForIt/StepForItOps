/** URL directe d'un workflow dans l'éditeur n8n (ex: https://n8n.example.com/workflow/abc). */
export function n8nWorkflowUrl(baseUrl: string, externalId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/workflow/${externalId}`;
}
