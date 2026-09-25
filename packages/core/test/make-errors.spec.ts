import { describe, expect, it } from 'vitest';
import { makeErrorMessage } from '../src/domain/make/make-errors';

describe('makeErrorMessage', () => {
  it('distingue un jeton malformé d un droit manquant : Make répond 401 dans les deux cas', () => {
    const malforme = makeErrorMessage(
      401,
      { detail: 'Invalid token header.', message: 'Access denied' },
      'eu1.make.com',
    );
    expect(malforme).toMatch(/malformé/);
    expect(malforme).not.toMatch(/zone/);
  });

  it('nomme la piste de la mauvaise zone, que la réponse de Make ne donne jamais', () => {
    const refus = makeErrorMessage(
      401,
      { detail: 'Not authorized.', message: 'Access denied' },
      'eu2.make.com',
    );
    expect(refus).toMatch(/eu2\.make\.com/);
    expect(refus).toMatch(/autre zone/);
  });

  it('dit que le plafond est celui de l organisation', () => {
    expect(makeErrorMessage(429, { message: 'Too many requests' }, 'eu1.make.com')).toMatch(/Plafond/);
  });

  it('reprend les suberrors de validation, qui portent la vraie cause', () => {
    const message = makeErrorMessage(
      400,
      {
        detail: 'Validation of query columns failed',
        message: 'Bad Request',
        suberrors: [{ message: 'Expected union value' }],
      },
      'eu1.make.com',
    );
    expect(message).toMatch(/Validation of query columns failed/);
    expect(message).toMatch(/Expected union value/);
  });

  it('supporte un corps qui n est pas du JSON', () => {
    expect(makeErrorMessage(502, '<html>gateway</html>', 'eu1.make.com')).toBe('<html>gateway</html>');
  });
});
