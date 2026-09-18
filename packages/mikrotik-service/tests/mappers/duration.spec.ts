import { parseRouterOsDuration } from '../../src/mappers/hotspot.mapper';

describe('parseRouterOsDuration', () => {
  // Valeurs relevées telles quelles sur un hAP ac² en RouterOS 7.24.4.
  describe('format compact (API REST v7)', () => {
    it.each([
      ['3s', 3],
      ['2m28s', 148],
      ['1h32m42s', 5562],
      ['8h41m34s', 31294],
      ['1d7h2m59s', 111779],
      ['4w2d', 2592000],
      ['4w1d23h57m32s', 2591852],
    ])('%s → %i secondes', (input, expected) => {
      expect(parseRouterOsDuration(input)).toBe(expected);
    });
  });

  describe('format hérité (notation horloge)', () => {
    it.each([
      ['00:05:00', 300],
      ['1d02:03:04', 93784],
    ])('%s → %i secondes', (input, expected) => {
      expect(parseRouterOsDuration(input)).toBe(expected);
    });
  });

  it('accepte une valeur nue déjà exprimée en secondes', () => {
    expect(parseRouterOsDuration('3600')).toBe(3600);
  });

  it('retourne 0 pour une valeur absente ou vide', () => {
    expect(parseRouterOsDuration(null)).toBe(0);
    expect(parseRouterOsDuration(undefined)).toBe(0);
    expect(parseRouterOsDuration('')).toBe(0);
  });
});
