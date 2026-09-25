import { describe, expect, it } from 'vitest';
import { describePublishRefusal, parsePublishRefusal } from '../src/domain/n8n/n8n-publish-refusal';

/** Corps réel d'un refus n8n, tel qu'il arrive : du JSON source, échappé. */
const BODY =
  'n8n API PUT /workflows/vGCEYyzlPkeOUTub → 400: {"message":"Cannot publish workflow: ' +
  '2 nodes have configuration issues:\\n\\nNode \\"Notion - Récupérer posts\\":\\n' +
  '  - Missing required credential: notionApi\\n\\nNode \\"IA - Génération texte\\":\\n' +
  '  - Missing required credential: openAiApi\\n"}';

describe('n8n-publish-refusal', () => {
  it('extrait chaque nœud fautif et son grief', () => {
    const refusal = parsePublishRefusal(BODY);
    expect(refusal?.declared).toBe(2);
    expect(refusal?.nodes).toEqual([
      { node: 'Notion - Récupérer posts', problems: ['Missing required credential: notionApi'] },
      { node: 'IA - Génération texte', problems: ['Missing required credential: openAiApi'] },
    ]);
  });

  it('ignore les erreurs n8n ordinaires', () => {
    expect(parsePublishRefusal('n8n API PUT /workflows/x → 404: {"message":"not found"}')).toBeUndefined();
  });

  it('compte les nœuds annoncés que le corps tronqué ne détaille pas', () => {
    const truncated = BODY.slice(0, BODY.indexOf('IA - Génération texte'));
    const refusal = parsePublishRefusal(truncated);
    expect(refusal?.nodes).toHaveLength(1);
    expect(describePublishRefusal(refusal!)).toContain('+ 1 autre');
  });

  it('rend le grief en français et rappelle que rien n’a été écrit', () => {
    const message = describePublishRefusal(parsePublishRefusal(BODY)!);
    expect(message).toContain('« Notion - Récupérer posts » : credential « notionApi » non résolue');
    expect(message).toContain('Rien n’a été modifié dans n8n');
  });
});
