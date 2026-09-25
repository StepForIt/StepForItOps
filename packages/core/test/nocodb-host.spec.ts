import { describe, expect, it } from 'vitest';
import { guessNocoDbHosts, isNocoDbCloud } from '../src/domain/n8n/nocodb-host';

const TABLE = 'm2pyc92tnxry3l5';
const BASE = 'p8r3blelqs0g135';

describe('nocodb-host', () => {
  it('déduit l’instance d’un appel HTTP qui porte un id de table connu', () => {
    const hints = guessNocoDbHosts(
      [
        {
          url: `=https://app.nocodb.com/api/v2/tables/${TABLE}/links/c12x/records/{{ $json.id }}`,
          workflowName: 'Sync contacts',
          nodeName: 'Link record',
        },
      ],
      [BASE, TABLE],
    );
    expect(hints).toEqual([
      {
        host: 'https://app.nocodb.com',
        matchedId: TABLE,
        sourceUrl: `=https://app.nocodb.com/api/v2/tables/${TABLE}/links/c12x/records/{{ $json.id }}`,
        workflowName: 'Sync contacts',
        nodeName: 'Link record',
      },
    ]);
  });

  it('garde le port et le schéma d’une instance auto-hébergée', () => {
    const hints = guessNocoDbHosts(
      [{ url: `http://nocodb.maison.lan:8080/api/v1/db/data/noco/${BASE}/Contacts` }],
      [BASE],
    );
    expect(hints[0].host).toBe('http://nocodb.maison.lan:8080');
  });

  it('ignore un appel qui ne porte aucun id connu, même sur une route NocoDB', () => {
    expect(guessNocoDbHosts([{ url: 'https://autre.nocodb.com/api/v2/meta/bases' }], [BASE])).toEqual([]);
  });

  it('ignore une URL qui porte l’id mais n’est pas une API NocoDB', () => {
    expect(guessNocoDbHosts([{ url: `https://hooks.zapier.com/x/${TABLE}` }], [TABLE])).toEqual([]);
  });

  it('ne retient chaque instance qu’une fois', () => {
    const hints = guessNocoDbHosts(
      [
        { url: `https://app.nocodb.com/api/v2/tables/${TABLE}/records` },
        { url: `https://app.nocodb.com/api/v2/tables/${TABLE}/records/1` },
      ],
      [TABLE],
    );
    expect(hints).toHaveLength(1);
  });

  it('ne se laisse pas piéger par un id trop court pour être discriminant', () => {
    expect(guessNocoDbHosts([{ url: 'https://app.nocodb.com/api/v2/tables/abc/records' }], ['abc'])).toEqual(
      [],
    );
  });
});

describe('isNocoDbCloud', () => {
  it('reconnaît le cloud, avec ou sans schéma', () => {
    expect(isNocoDbCloud('https://app.nocodb.com')).toBe(true);
    expect(isNocoDbCloud('app.nocodb.com')).toBe(true);
    expect(isNocoDbCloud('https://APP.NoCoDB.com/')).toBe(true);
  });

  it('laisse l’auto-hébergé tranquille, même sur un port ou un sous-domaine', () => {
    expect(isNocoDbCloud('http://nocodb.maison.lan:8080')).toBe(false);
    expect(isNocoDbCloud('https://nocodb.acme-corp.example')).toBe(false);
  });

  it('ne confond pas un domaine qui se termine par la même chaîne', () => {
    expect(isNocoDbCloud('https://faux-nocodb.com')).toBe(false);
    expect(isNocoDbCloud('https://monnocodb.com')).toBe(false);
  });
});
