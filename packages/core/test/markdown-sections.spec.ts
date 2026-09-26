import { describe, expect, it } from 'vitest';
import {
  demoteHeadings,
  findSections,
  readDocSection,
  splitMarkdownSections,
} from '../src/domain/markdown-sections';

const README = [
  '# n8n-nodes-foo',
  'Un nœud pour Foo.',
  '',
  '## Installation',
  'npm install n8n-nodes-foo',
  '',
  '## Credentials',
  'Créez une clé API dans Foo.',
  '### OAuth2',
  'Renseignez le client id.',
  '',
  '## Opérations',
  '```md',
  '# pas un titre',
  '```',
  '- Envoyer un message',
].join('\n');

describe('splitMarkdownSections', () => {
  it('découpe par titre et ignore ceux des blocs de code', () => {
    const sections = splitMarkdownSections(README);
    expect(sections.map((section) => `${section.level}:${section.title}`)).toEqual([
      '1:n8n-nodes-foo',
      '2:Installation',
      '2:Credentials',
      '3:OAuth2',
      '2:Opérations',
    ]);
  });

  it('range un préambule sans titre sous « Introduction »', () => {
    const sections = splitMarkdownSections('Texte libre.\n\n## Usage\nx');
    expect(sections[0]).toMatchObject({ title: 'Introduction', level: 1 });
    expect(sections[0].content).toContain('Texte libre.');
  });

  it('inclut les sous-sections dans le contenu d’une section', () => {
    const credentials = splitMarkdownSections(README).find((section) => section.title === 'Credentials');
    expect(credentials?.content).toContain('Renseignez le client id.');
    expect(credentials?.content).not.toContain('Envoyer un message');
  });
});

describe('findSections', () => {
  const sections = splitMarkdownSections(README);

  it('apparie sans tenir compte de la casse ni des accents', () => {
    expect(findSections(sections, 'operations').map((section) => section.title)).toEqual(['Opérations']);
  });

  it('préfère le titre exact à une simple inclusion', () => {
    expect(findSections(sections, 'oauth2').map((section) => section.title)).toEqual(['OAuth2']);
  });

  it('rend une liste vide quand rien ne correspond', () => {
    expect(findSections(sections, 'webhook')).toEqual([]);
  });
});

describe('readDocSection', () => {
  it('sans section, rend le sommaire et le début du document', () => {
    const text = readDocSection(README, undefined, 5000);
    expect(text).toContain('Contents');
    expect(text).toContain('- Credentials');
    expect(text).toContain('Un nœud pour Foo.');
  });

  it('rend la section demandée', () => {
    const text = readDocSection(README, 'credentials', 5000);
    expect(text).toContain('Créez une clé API');
    expect(text).not.toContain('npm install');
  });

  it('section introuvable : le dit et rend le sommaire', () => {
    const text = readDocSection(README, 'webhook', 5000);
    expect(text).toContain('No section "webhook"');
    expect(text).toContain('- Installation');
  });

  it('coupe au plafond en le disant', () => {
    const text = readDocSection(`## Long\n${'x'.repeat(500)}`, 'long', 100);
    expect(text.length).toBeLessThan(250);
    expect(text).toContain('[cut');
  });
});

describe('demoteHeadings', () => {
  it('descend chaque titre d’un niveau, sans toucher aux blocs de code ni dépasser 6', () => {
    expect(demoteHeadings('# A\n```\n# code\n```\n###### F')).toBe('## A\n```\n# code\n```\n###### F');
  });
});
