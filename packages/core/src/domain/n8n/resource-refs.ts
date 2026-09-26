import { msg } from '../../i18n';
import { N8nNode, N8nWorkflow } from './workflow.types';
import { paramLabel as name, paramString as str } from './n8n-params';

/** Référence d'une ressource externe détectée dans un nœud. */
export interface ResourceRef {
  /** Clé canonique, ex: `airtable:appXXX/tblYYY`, `sheets:1AbC...`, `notion:db-id`, `http:api.example.com` */
  key: string;
  provider: 'airtable' | 'google-sheets' | 'notion' | 'nocodb' | 'postgres' | 'http' | 'execute-workflow';
  nodeName: string;
  /** Nom lisible fourni par n8n (`cachedResultName` des resourceLocator), si disponible. */
  label?: string;
  /**
   * Les deux noms lisibles séparés, quand la ressource en a deux : le contenant
   * (base Airtable, document Sheets, projet NocoDB) et l'élément (table, onglet).
   * `label` les colle pour l'affichage ; les garder distincts permet de chercher
   * « CRM » (la base) et d'obtenir toutes ses tables, ou de grouper le sélecteur.
   */
  names?: { container?: string; item?: string };
  detail?: Record<string, string>;
}

/** Host d'une URL, y compris pour une expression dont le début est littéral (`=https://x.com/{{ id }}`). */
function hostOf(url: string): string | undefined {
  let literal = url.includes('{{') ? url.slice(0, url.indexOf('{{')) : url;
  if (literal.startsWith('=')) literal = literal.slice(1);
  try {
    const host = new URL(literal).host;
    return host.length > 0 ? host : undefined;
  } catch {
    return undefined;
  }
}

/** Combine les noms lisibles disponibles ("Doc — Onglet"), ou undefined si aucun. */
function joinNames(...parts: Array<string | undefined>): string | undefined {
  const present = parts.filter((p): p is string => Boolean(p));
  return present.length > 0 ? present.join(' — ') : undefined;
}

/** Ressources externes référencées par un seul nœud. */
export function extractNodeResourceRefs(node: N8nNode): ResourceRef[] {
  const p = node.parameters ?? {};
  const type = node.type.toLowerCase();
  const refs: ResourceRef[] = [];

  if (type.includes('airtable')) {
    const baseParam = p['base'] ?? p['application'];
    const base = str(baseParam);
    const table = str(p['table']);
    if (base) {
      refs.push({
        key: `airtable:${base}${table ? `/${table}` : ''}`,
        provider: 'airtable',
        nodeName: node.name,
        label: joinNames(name(baseParam), name(p['table'])),
        names: { container: name(baseParam), item: name(p['table']) },
        detail: { base: base ?? '', table: table ?? '' },
      });
    }
  } else if (type.includes('googlesheets')) {
    const docParam = p['documentId'] ?? p['sheetId'];
    const doc = str(docParam);
    if (doc) {
      refs.push({
        key: `sheets:${doc}`,
        provider: 'google-sheets',
        nodeName: node.name,
        label: joinNames(name(docParam), name(p['sheetName'])),
        names: { container: name(docParam), item: name(p['sheetName']) },
      });
    }
  } else if (type.includes('notion')) {
    const dbParam = p['databaseId'] ?? p['pageId'] ?? p['resource'];
    const db = str(dbParam);
    if (db) {
      refs.push({
        key: `notion:${db}`,
        provider: 'notion',
        nodeName: node.name,
        label: name(dbParam),
        names: { item: name(dbParam) },
      });
    }
  } else if (type.includes('nocodb')) {
    const table = str(p['table']);
    const project = str(p['projectId']) ?? str(p['workspaceId']);
    if (table || project) {
      refs.push({
        key: `nocodb:${project ?? '?'}${table ? `/${table}` : ''}`,
        provider: 'nocodb',
        nodeName: node.name,
        label: joinNames(name(p['projectId']), name(p['table'])),
        names: { container: name(p['projectId']), item: name(p['table']) },
      });
    }
  } else if (type.includes('postgres')) {
    const table = str(p['table']);
    if (table) {
      refs.push({
        key: `postgres:${table}`,
        provider: 'postgres',
        nodeName: node.name,
        label: joinNames(name(p['schema']), name(p['table'])) ?? table,
        names: { container: name(p['schema']), item: name(p['table']) ?? table },
      });
    }
  } else if (type.includes('httprequest')) {
    const url = str(p['url']);
    if (url) {
      const host = hostOf(url);
      if (host)
        refs.push({
          key: `http:${host}`,
          provider: 'http',
          nodeName: node.name,
          names: { container: host },
          detail: { url },
        });
      else
        refs.push({
          key: `http:${url}`,
          provider: 'http',
          nodeName: node.name,
          label: msg('env.dynamicUrl'),
          detail: { url },
        });
    }
  } else if (type.includes('executeworkflow')) {
    const wf = str(p['workflowId']);
    if (wf) {
      refs.push({
        key: `workflow:${wf}`,
        provider: 'execute-workflow',
        nodeName: node.name,
        label: name(p['workflowId']),
      });
    }
  }
  return refs;
}

/** Toutes les ressources externes référencées par un workflow. */
export function extractResourceRefs(workflow: N8nWorkflow): ResourceRef[] {
  return workflow.nodes.flatMap((node) => extractNodeResourceRefs(node));
}
