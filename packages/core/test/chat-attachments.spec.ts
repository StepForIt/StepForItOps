import { describe, expect, it } from 'vitest';
import {
  CHAT_FILE_MAX_BYTES,
  CHAT_FILE_MAX_PER_MESSAGE,
  CHAT_IMAGE_MAX_BYTES,
  ChatFileError,
  ChatImageError,
  limitHistoryFiles,
  limitHistoryImages,
  parseChatFile,
  parseChatFiles,
  parseChatImage,
  parseChatImages,
  renderChatFiles,
} from '../src/domain/chat-attachments';

const png = Buffer.from('capture').toString('base64');

describe('parseChatImage', () => {
  it('accepte un couple type + base64', () => {
    const image = parseChatImage({ mediaType: 'image/png', data: png });
    expect(image).toEqual({ mediaType: 'image/png', data: png, size: 7 });
  });

  it('démonte une data-URL, forme produite par un collage navigateur', () => {
    const image = parseChatImage({ data: `data:image/JPEG;base64,${png}` });
    expect(image.mediaType).toBe('image/jpeg');
    expect(image.data).toBe(png);
  });

  it('refuse un format que le modèle ne sait pas lire', () => {
    expect(() => parseChatImage({ mediaType: 'application/pdf', data: png })).toThrow(ChatImageError);
    expect(() => parseChatImage({ data: png })).toThrow(ChatImageError);
  });

  it('refuse une image trop lourde plutôt que de la laisser échouer côté API', () => {
    const huge = 'A'.repeat(Math.ceil(((CHAT_IMAGE_MAX_BYTES + 1024) * 4) / 3));
    expect(() => parseChatImage({ mediaType: 'image/png', data: huge })).toThrow(/trop lourde/);
  });

  it('refuse du base64 invalide', () => {
    expect(() => parseChatImage({ mediaType: 'image/png', data: 'pas du base64 !' })).toThrow(ChatImageError);
  });
});

describe('parseChatImages', () => {
  it('borne le nombre d’images par message', () => {
    const one = { mediaType: 'image/png', data: png };
    expect(parseChatImages([one, one])).toHaveLength(2);
    expect(() => parseChatImages([one, one, one, one, one])).toThrow(/au maximum/);
  });

  it('rend une liste vide quand rien n’est joint', () => {
    expect(parseChatImages(undefined)).toEqual([]);
  });
});

describe('limitHistoryImages', () => {
  const image = (name: string) => ({ mediaType: 'image/png' as const, data: name, size: 1 });

  it('ne garde que les dernières images, sans toucher aux messages', () => {
    const messages = [
      { content: 'a', images: [image('1'), image('2')] },
      { content: 'b' },
      { content: 'c', images: [image('3'), image('4'), image('5')] },
    ];
    const limited = limitHistoryImages(messages, 4);
    expect(limited.map((m) => m.content)).toEqual(['a', 'b', 'c']);
    expect(limited[0].images?.map((i) => i.data)).toEqual(['2']);
    expect(limited[2].images?.map((i) => i.data)).toEqual(['3', '4', '5']);
  });

  it('laisse l’historique intact quand il tient dans le budget', () => {
    const messages = [{ content: 'a', images: [image('1')] }];
    expect(limitHistoryImages(messages, 4)).toEqual(messages);
  });
});

describe('parseChatFiles', () => {
  it('accepte un fichier texte et en déduit le type par son extension', () => {
    const [file] = parseChatFiles([{ name: 'export.json', mediaType: '', text: '{"a":1}' }]);
    expect(file).toMatchObject({ name: 'export.json', mediaType: 'application/json', size: 7 });
  });

  it('refuse un binaire déguisé, un fichier vide et un lot trop nombreux', () => {
    expect(() => parseChatFile({ name: 'faux.txt', text: `PK${String.fromCharCode(0)}archive` })).toThrow(
      ChatFileError,
    );
    expect(() => parseChatFile({ name: 'vide.txt', text: '   ' })).toThrow(ChatFileError);
    expect(() => parseChatFile({ name: 'photo.png', text: 'x' })).toThrow(ChatFileError);
    const many = Array.from({ length: CHAT_FILE_MAX_PER_MESSAGE + 1 }, () => ({ name: 'a.txt', text: 'x' }));
    expect(() => parseChatFiles(many)).toThrow(ChatFileError);
  });

  it('refuse un fichier plus lourd que la borne, avant tout appel IA', () => {
    const huge = 'x'.repeat(CHAT_FILE_MAX_BYTES + 1);
    expect(() => parseChatFile({ name: 'gros.csv', text: huge })).toThrow(ChatFileError);
  });
});

describe('renderChatFiles', () => {
  it('range la demande avant les fichiers, chacun nommé dans son bloc', () => {
    const rendered = renderChatFiles('Pourquoi ça plante ?', [
      { name: 'run.log', mediaType: 'text/plain', text: 'boom', size: 4 },
    ]);
    expect(rendered.startsWith('Pourquoi ça plante ?')).toBe(true);
    expect(rendered).toContain('--- Attached file: run.log (4 B) ---');
    expect(rendered).toContain('boom');
  });

  it('ouvre un bloc plus long que les backticks du contenu, qui le refermeraient', () => {
    const rendered = renderChatFiles('', [
      { name: 'a.md', mediaType: 'text/markdown', text: '```js\ncode\n```', size: 15 },
    ]);
    expect(rendered).toContain('````markdown');
  });

  it('annonce un fichier écarté du rejeu sans inventer son contenu', () => {
    const rendered = renderChatFiles('suite', [
      { name: 'vieux.csv', mediaType: 'text/csv', text: '', size: 2048, dropped: true },
    ]);
    expect(rendered).toContain('content not replayed');
  });
});

describe('limitHistoryFiles', () => {
  it('garde les plus récents dans le budget et vide les autres, sans perdre leur nom', () => {
    const file = (name: string, size: number) => ({
      name,
      mediaType: 'text/plain',
      text: 'x'.repeat(size),
      size,
    });
    const messages = [{ files: [file('vieux.txt', 80)] }, { files: [file('neuf.txt', 80)] }];
    const limited = limitHistoryFiles(messages, 100);
    expect(limited[0].files[0]).toMatchObject({ name: 'vieux.txt', text: '', dropped: true, size: 80 });
    expect(limited[1].files[0].text).toHaveLength(80);
  });
});
