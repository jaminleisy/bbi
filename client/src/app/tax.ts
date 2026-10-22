/** Sales tax multiplier for tax-inclusive amounts (9.25%). */
export const TAX_INCLUSIVE_DIVISOR = 1.0925;

/**
 * Tax portion of a tax-inclusive total: amount − amount / 1.0925.
 * Uses integer-cent math (AwayFromZero) to match the server and avoid
 * IEEE-float off-by-a-cent errors from `Math.round((n - n/1.0925)*100)/100`.
 *
 * 1.0925 = 437/400, so pretax = amount×400/437 and tax = amount − pretax.
 */
export function taxFromInclusiveAmount(amount: number | string | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === '') return null;
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(n)) return null;

  const totalCents = Math.round(n * 100);
  const pretaxCents = divRoundAwayFromZero(totalCents * 400, 437);
  return (totalCents - pretaxCents) / 100;
}

/** Integer division rounded to nearest, ties away from zero (matches .NET MidpointRounding.AwayFromZero). */
function divRoundAwayFromZero(numer: number, denom: number): number {
  if (denom === 0) throw new Error('division by zero');
  const neg = numer < 0;
  const a = Math.abs(numer);
  const q = Math.floor(a / denom);
  const r = a % denom;
  const roundUp = r * 2 >= denom;
  const abs = q + (roundUp ? 1 : 0);
  return neg ? -abs : abs;
}
