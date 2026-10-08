import { describe, expect, it } from 'vitest';
import { cleanGtin, validGtin } from '../src/barcode.js';

describe('GTIN', () => {
  it('checks the check digit of EAN-13, EAN-8, UPC-A and GTIN-14', () => {
    expect(validGtin('4006040123453')).toBe(true);
    expect(validGtin('4006040123456')).toBe(false);
    expect(validGtin('96385074')).toBe(true);
    expect(validGtin('036000291452')).toBe(true);
    expect(validGtin('10036000291459')).toBe(true);
    expect(validGtin('123')).toBe(false);
    expect(validGtin('40060401234530')).toBe(false);
  });

  it('cleans what a model or a person wrote', () => {
    expect(cleanGtin('4 006040 123453')).toBe('4006040123453');
    expect(cleanGtin('EAN: 4006040123453')).toBe('4006040123453');
    expect(cleanGtin('4006040123456')).toBeNull();
    expect(cleanGtin(null)).toBeNull();
    expect(cleanGtin('')).toBeNull();
  });
});
