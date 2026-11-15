// EMBERLINE palette: six values and one accent hue, the whole look plan. The same six names
// are the CSS custom properties in index.html, so the HUD and the world never drift apart.
export const PALETTE = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
};

export function shade(name) {
  return PALETTE[name];
}
