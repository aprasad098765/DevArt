// Regenerates the app icons in client/public from the DevArt mark: `npm run icons`.
import { writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const mark = '<path d="M9 8h6a8 8 0 0 1 0 16H9z" fill="none" stroke="#fff" stroke-width="3"/><circle cx="23" cy="9" r="3" fill="#ffc857"/>';
const standard = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0d7c6e"/>${mark}</svg>`;
// Maskable icons get cropped by the OS, so the background is full-bleed and the mark stays in the safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0d7c6e"/><g transform="translate(6.4 6.4) scale(0.6)">${mark}</g></svg>`;
const appleTouch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0d7c6e"/><g transform="translate(3.2 3.2) scale(0.8)">${mark}</g></svg>`;

for (const [name, svg, size] of [
  ['icon-192.png', standard, 192], ['icon-512.png', standard, 512],
  ['icon-maskable-512.png', maskable, 512], ['apple-touch-icon.png', appleTouch, 180],
] as const) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(`client/public/${name}`, png);
}
