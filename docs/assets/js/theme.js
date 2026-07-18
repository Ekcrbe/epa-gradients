// Theme-aware diverging color for the heatmap (blue = easier, red = harder,
// neutral midpoint that matches light/dark surfaces).

const RAMP = {
  light: { mid: [240, 239, 236], pos: [198, 57, 43], neg: [47, 111, 176] },
  dark: { mid: [42, 47, 53], pos: [224, 101, 95], neg: [95, 159, 214] },
};

export function isDark() {
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

// v in displacement units, M the symmetric domain half-width.
export function divergingColor(v, M, dark = isDark()) {
  const r = dark ? RAMP.dark : RAMP.light;
  const t = Math.max(-1, Math.min(1, M ? v / M : 0));
  const end = t >= 0 ? r.pos : r.neg;
  const a = Math.abs(t);
  const c = r.mid.map((mid, i) => Math.round(mid + (end[i] - mid) * a));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
