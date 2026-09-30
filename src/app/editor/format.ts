/** A number for the node value readout: fixed width so it doesn't jitter as values change. */
export function fmtValue(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "\u2007∞" : "-∞";
  // always 3 decimals, and a figure space where the minus sign would go, so the text keeps
  // its width as values change (the readout uses a monospaced font)
  const s = Math.abs(v) >= 1e5 ? v.toExponential(2) : v.toFixed(3);
  if (s === "-0.000") return "\u20070.000";
  return s.startsWith("-") ? s : `\u2007${s}`;
}
