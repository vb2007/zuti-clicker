const SUFFIXES = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
// One magnitude past the last suffix ("Dc" = 1e33) — beyond this we fall back
// to compact exponential notation rather than let the suffix ladder run out
// and produce unreadable digit strings (e.g. the old "999999999999999872.00Oc").
const EXPONENTIAL_THRESHOLD = 1e36;

function formatScaled(n: number, decimals: number): string {
  if (n >= EXPONENTIAL_THRESHOLD) {
    const [mantissa, exponent] = n.toExponential(decimals).split("e");
    return `${mantissa}e${Number(exponent)}`; // "1.00e36", not "1.00e+36"
  }
  const exp = Math.min(Math.floor(Math.log10(n) / 3), SUFFIXES.length - 1);
  const suffix = SUFFIXES[exp] ?? "";
  const scaled = n / Math.pow(1000, exp);
  return scaled.toFixed(decimals) + suffix;
}

export function formatNumber(n: number, decimals = 2): string {
  if (Number.isNaN(n)) return "0";
  if (!isFinite(n)) return "∞";
  if (n < 1000) return Math.floor(n).toString();
  return formatScaled(n, decimals);
}

// TPS, per-unit production -> shows decimals when value < 100
export function formatRate(n: number): string {
  if (Number.isNaN(n)) return "0.00";
  if (!isFinite(n)) return "∞";
  if (n === 0) return "0.00";
  if (n < 100) return n.toFixed(2);
  if (n < 1000) return Math.floor(n).toString();
  return formatScaled(n, 2);
}

// Whole-percent rounding (Math.round) misrepresents a half-percent-per-step
// rate: e.g. a single PhD's true 0.5% cost discount rounds up to "1%", making
// it look exactly double the real rate. Keeps one decimal only when it's not
// a whole number, so "1 PhD" reads "0.5%" and "2 PhD" still reads "1%".
export function formatPercent(value: number): string {
  if (!isFinite(value)) return "0";
  return value.toFixed(1).replace(/\.0$/, "");
}

// A win chance given in parts per million (the upgrader's native unit — see
// utils/upgrader.ts) as a percentage with up to 2 decimals, trailing zeros
// trimmed: 450000 -> "45", 25000 -> "2.5", 179999 -> "18". Two places because
// the chance steps in fine increments (x100 is 0.9%, x36 is exactly 2.5%) and a
// whole-number rounding would misstate them — see formatPercent's note.
export function formatChancePpm(ppm: number): string {
  if (!isFinite(ppm)) return "0";
  return (ppm / 10_000).toFixed(2).replace(/\.?0+$/, "");
}

// Floating "+X" click value. A fractional prestige multiplier (e.g. 32 PhD ->
// x1.6400000000000001) must never reach the DOM as a raw float — round to 2
// decimals and trim trailing zeros, same spirit as formatPercent's trim but
// keeping up to 2 places since a per-click gain has no half-step meaning to
// preserve. toFixed(2) can carry a value like 999.996 up to "1000.00", which
// belongs on the suffix ladder, not printed as a bare 4-digit number.
export function formatGain(n: number): string {
  if (Number.isNaN(n)) return "0";
  if (!isFinite(n)) return "∞";
  if (n < 1000) {
    const rounded = Number(n.toFixed(2));
    return rounded < 1000 ? String(rounded) : formatScaled(rounded, 2);
  }
  return formatScaled(n, 2);
}

export function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
