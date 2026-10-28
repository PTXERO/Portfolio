import Decimal from 'break_infinity.js';

export { Decimal };

export const D = (v: number | string | Decimal): Decimal => new Decimal(v);
export const ZERO = new Decimal(0);

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Short display form: 999, 1.23K, 45.6M, ... then 1.23e36 past decillions. */
export function format(n: Decimal, digits = 2): string {
  if (n.lt(0)) return '-' + format(n.neg(), digits);
  if (n.lt(1000)) {
    const v = n.toNumber();
    return Number.isInteger(v) ? String(v) : v.toFixed(v < 10 ? 1 : 0);
  }
  const exp = n.exponent;
  const tier = Math.floor(exp / 3);
  if (tier < SUFFIXES.length) {
    const scaled = n.mantissa * Math.pow(10, exp - tier * 3);
    return scaled.toFixed(scaled < 100 ? digits : 1) + SUFFIXES[tier];
  }
  return n.mantissa.toFixed(digits) + 'e' + exp;
}

/** Seconds as "45s", "12m 3s", "3h 20m", "2d 4h". */
export function formatTime(sec: number): string {
  if (!isFinite(sec)) return '∞';
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
