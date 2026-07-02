/**
 * Generates public/og.png (1200×630) — the social/link-preview image.
 * Run once (or after a brand change):  node scripts/og.mjs
 */
import sharp from "sharp";
import { join } from "node:path";

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#0f172a"/>
  <rect width="14" height="630" fill="#c2683a"/>
  <!-- Logo + wordmark, side by side so nothing overlaps -->
  <g transform="translate(96,112)">
    <path d="M150 6 a92 92 0 1 0 0 168" fill="none" stroke="#c2683a" stroke-width="32" stroke-linecap="round"/>
    <circle cx="96" cy="90" r="17" fill="#e2e8f0"/>
  </g>
  <text x="330" y="232" font-family="sans-serif" font-size="104" font-weight="bold" fill="#f8fafc">Codewire</text>
  <text x="96" y="372" font-family="sans-serif" font-size="40" fill="#94a3b8">Five NEC calculators in one fast, free app</text>
  <text x="96" y="442" font-family="sans-serif" font-size="29" fill="#cbd5e1">Voltage Drop  ·  Conduit Fill  ·  Box Fill  ·  Wire Ampacity  ·  Bending</text>
  <text x="96" y="520" font-family="sans-serif" font-size="34" font-weight="bold" fill="#c2683a">codewire.tools</text>
</svg>`;

const out = join(process.cwd(), "public", "og.png");
await sharp(Buffer.from(svg)).png().toFile(out);
console.log("og: wrote public/og.png");
