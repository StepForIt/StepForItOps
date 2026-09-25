import { describe, expect, it } from 'vitest';
import { extractResourceRefs } from '../src/domain/n8n/resource-refs';
import { N8nWorkflow } from '../src/domain/n8n/workflow.types';

function workflowWith(nodes: Array<Record<string, unknown>>): N8nWorkflow {
  return { id: 'wf', name: 'WF', nodes, connections: {} } as unknown as N8nWorkflow;
}

describe('resource-refs', () => {
  it('uses cachedResultName as label when the resourceLocator provides one', () => {
    const refs = extractResourceRefs(
      workflowWith([
        {
          name: 'Sheets',
          type: 'n8n-nodes-base.googleSheets',
          parameters: {
            documentId: { __rl: true, mode: 'list', value: '1AbC', cachedResultName: 'Tableau de bord' },
            sheetName: { __rl: true, mode: 'list', value: 42, cachedResultName: 'Emails traités' },
          },
        },
      ]),
    );
    expect(refs).toEqual([
      {
        key: 'sheets:1AbC',
        provider: 'google-sheets',
        nodeName: 'Sheets',
        label: 'Tableau de bord — Emails traités',
        names: { container: 'Tableau de bord', item: 'Emails traités' },
      },
    ]);
  });

  it('leaves label undefined when n8n only stores raw ids (NocoDB v3)', () => {
    const refs = extractResourceRefs(
      workflowWith([
        {
          name: 'NocoDB1',
          type: 'n8n-nodes-base.nocoDb',
          parameters: { table: 'm2pyc92tnxry3l5', projectId: 'p8r3blelqs0g135', operation: 'update' },
        },
      ]),
    );
    expect(refs).toEqual([
      {
        key: 'nocodb:p8r3blelqs0g135/m2pyc92tnxry3l5',
        provider: 'nocodb',
        nodeName: 'NocoDB1',
        label: undefined,
        names: { container: undefined, item: undefined },
      },
    ]);
  });

  it('strips the n8n "=" expression prefix from static values (dedupes keys)', () => {
    const refs = extractResourceRefs(
      workflowWith([
        {
          name: 'NocoDB static expr',
          type: 'n8n-nodes-base.nocoDb',
          parameters: { table: '=mfs3kpqrrz07zv7', projectId: 'pkgxys72rvzm3xz' },
        },
      ]),
    );
    expect(refs[0].key).toBe('nocodb:pkgxys72rvzm3xz/mfs3kpqrrz07zv7');
  });

  it('extracts the host from an expression URL with a literal start', () => {
    const refs = extractResourceRefs(
      workflowWith([
        {
          name: 'HTTP',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: '=https://app.nocodb.com/api/v2/tables/{{ $json.id }}/records' },
        },
      ]),
    );
    expect(refs[0].key).toBe('http:app.nocodb.com');
  });

  it('labels fully dynamic URLs as such', () => {
    const refs = extractResourceRefs(
      workflowWith([
        {
          name: 'HTTP',
          type: 'n8n-nodes-base.httpRequest',
          parameters: { url: '={{ $json.download_url }}' },
        },
      ]),
    );
    expect(refs[0].label).toBe('URL dynamique');
  });

  it('labels Execute Workflow refs with the cached workflow name', () => {
    const refs = extractResourceRefs(
      workflowWith([
        {
          name: 'Call sub',
          type: 'n8n-nodes-base.executeWorkflow',
          parameters: {
            workflowId: {
              __rl: true,
              mode: 'list',
              value: 'abc123',
              cachedResultName: 'Sous-workflow contacts',
            },
          },
        },
      ]),
    );
    expect(refs).toEqual([
      {
        key: 'workflow:abc123',
        provider: 'execute-workflow',
        nodeName: 'Call sub',
        label: 'Sous-workflow contacts',
      },
    ]);
  });
});
