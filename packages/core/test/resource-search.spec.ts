import { describe, expect, it } from 'vitest';
import { matchesResourceQuery, resourceSearchTerms } from '../src/domain/resource-search';

const crmProspect = resourceSearchTerms({
  key: 'airtable:appvXfNXpVWSKdOcK/tblX0ebYB53kEqP0A',
  provider: 'airtable',
  providerLabel: 'Airtable',
  containerName: 'CRM',
  itemName: 'Prospect',
});

const crmSms = resourceSearchTerms({
  key: 'airtable:appvXfNXpVWSKdOcK/tblc2XQCqcb95clxt',
  provider: 'airtable',
  providerLabel: 'Airtable',
  containerName: 'CRM',
  itemName: 'SMS Queue',
});

describe('resource-search', () => {
  it('trouve toutes les tables d’une base par le nom de la base', () => {
    expect(matchesResourceQuery(crmProspect, 'CRM')).toBe(true);
    expect(matchesResourceQuery(crmSms, 'crm')).toBe(true);
  });

  it('resserre sur une table quand on ajoute son nom', () => {
    expect(matchesResourceQuery(crmProspect, 'crm prospect')).toBe(true);
    expect(matchesResourceQuery(crmSms, 'crm prospect')).toBe(false);
  });

  it('trouve une ressource par son système, quel que soit le nom des tables', () => {
    const anonyme = resourceSearchTerms({
      key: 'nocodb:pkgxys72rvzm3xz/mfs3kpqrrz07zv7',
      provider: 'nocodb',
      providerLabel: 'NocoDB',
    });
    expect(matchesResourceQuery(anonyme, 'noco')).toBe(true);
  });

  it('trouve une API externe par son hôte comme par une url appelée', () => {
    const api = resourceSearchTerms({
      key: 'http:db.acme-corp.example',
      provider: 'http',
      providerLabel: 'API',
      containerName: 'db.acme-corp.example',
      urls: ['https://db.acme-corp.example/api/v2/tables/mfs3/records'],
    });
    expect(matchesResourceQuery(api, 'acme-corp')).toBe(true);
    expect(matchesResourceQuery(api, 'api/v2/tables')).toBe(true);
    // Rien dans le JSON ne dit que cet hôte est un NocoDB : seul un alias le rattache.
    expect(matchesResourceQuery(api, 'noco')).toBe(false);
    const aliased = resourceSearchTerms({
      key: 'http:db.acme-corp.example',
      provider: 'http',
      providerLabel: 'API',
      alias: 'NocoDB · API directe',
    });
    expect(matchesResourceQuery(aliased, 'noco')).toBe(true);
  });

  it('laisse tout passer sur une saisie vide', () => {
    expect(matchesResourceQuery(crmProspect, '   ')).toBe(true);
  });

  it('retrouve une ressource par un id collé depuis une url', () => {
    expect(matchesResourceQuery(crmProspect, 'tblX0eb')).toBe(true);
  });
});
