/** Valid EAN/UPC (GTIN-8, -12, -13, -14) with a correct check digit (avoids misreads). */
export function validGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** The digits of a code read by a person or a model, if they form a valid GTIN; else null. */
export function cleanGtin(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return validGtin(digits) ? digits : null;
}
