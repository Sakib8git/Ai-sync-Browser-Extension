import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const watch = process.argv.includes('--watch');
const OUT = 'dist';

// ---- tiny PNG icon generator (avoids binary files and image dependencies) ----
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

/** Rounded violet square with a "baton pass": a filled dot, a link, and a ring. */
function iconPng(size) {
  const SS = 3; // supersampling for smooth edges
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const inRound = (x, y, r) => {
    const cx = Math.min(Math.max(x, r), 1 - r), cy = Math.min(Math.max(y, r), 1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let a = 0, white = 0, bg = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
        if (!inRound(x, y, 0.22)) continue;
        a++;
        const d1 = Math.hypot(x - 0.28, y - 0.5), d2 = Math.hypot(x - 0.72, y - 0.5);
        const isWhite = d1 <= 0.12 || (d2 <= 0.14 && d2 >= 0.08) || (Math.abs(y - 0.5) <= 0.035 && x > 0.28 && x < 0.72);
        if (isWhite) white++; else bg++;
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const total = SS * SS;
      if (a === 0) { raw[o + 3] = 0; continue; }
      const t = px / size; // subtle left-to-right violet gradient
      const base = [0x5b + t * 40, 0x3d + t * 30, 0xf5];
      const w = white / a;
      raw[o] = base[0] * (1 - w) + 255 * w;
      raw[o + 1] = base[1] * (1 - w) + 255 * w;
      raw[o + 2] = base[2] * (1 - w) + 255 * w;
      raw[o + 3] = Math.round((a / total) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function copyStatic() {
  cpSync('public', OUT, { recursive: true });
  cpSync('src/popup/popup.html', `${OUT}/popup.html`);
  mkdirSync(`${OUT}/icons`, { recursive: true });
  for (const s of [16, 32, 48, 128]) writeFileSync(`${OUT}/icons/icon${s}.png`, iconPng(s));
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyStatic();

const options = {
  entryPoints: {
    popup: 'src/popup/main.tsx',
    background: 'src/background/index.ts',
    content: 'src/content/index.ts',
  },
  outdir: OUT,
  bundle: true,
  format: 'iife', // content scripts cannot be ES modules in MV3
  target: 'chrome110',
  jsx: 'automatic',
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching for changes… reload the extension in chrome://extensions after edits.');
} else {
  await build(options);
}
