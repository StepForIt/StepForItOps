import { apiGet } from '../../lib/api';

/** Le fichier tel que l'API l'exporte : on ne le lit pas ici, on le transporte. */
export interface ProcedureBundle {
  kind: string;
  procedures: Array<{ name: string }>;
}

export interface ProcedureImportReport {
  dryRun: boolean;
  rows: Array<{
    name: string;
    importName: string;
    steps: number;
    status: 'new' | 'existing';
    outcome: 'create' | 'replace' | 'skip';
    warnings: string[];
  }>;
  created: number;
  replaced: number;
  skipped: number;
}

export type ImportConflict = 'skip' | 'replace' | 'duplicate';

/** Sans `ids`, toutes les procédures prêtes. Le nom du fichier dit ce qu'il contient et quand. */
export async function downloadProcedures(ids?: string[]): Promise<number> {
  const query = ids?.length ? `?ids=${ids.map(encodeURIComponent).join(',')}` : '';
  const bundle = await apiGet<ProcedureBundle>(`/release-procedures/export${query}`);
  const day = new Date().toISOString().slice(0, 10);
  const slug =
    bundle.procedures.length === 1
      ? bundle.procedures[0].name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      : `${bundle.procedures.length}`;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `procedures-${slug}-${day}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return bundle.procedures.length;
}
