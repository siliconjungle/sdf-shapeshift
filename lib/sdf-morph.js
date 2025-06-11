export const NUM_COLORS = 6;

export function drawImageBottomCenter(ctx, src, w, h, cw, ch) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => ctx.drawImage(img, (cw - w) / 2, ch - h);
  img.src = src;
}

export function nearestColorInPalette([r, g, b, a], palette) {
  if (!palette?.length) return [r | 0, g | 0, b | 0, a | 0];

  let best = palette[0], bestDist = Infinity;
  for (const c of palette) {
    const dr = c[0] - r, dg = c[1] - g, db = c[2] - b, da = c[3] - a;
    const d = dr * dr + dg * dg + db * db + da * da;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

export function unionPalettes(a, b) {
  const seen = new Set([...a, ...b].map(c => c.join(',')));
  return [...seen].map(s => s.split(',').map(n => +n));
}

export function drawSdfMorph(ctx, fromImg, toImg, cw, ch, t, clampPalette) {
  const out = ctx.createImageData(cw, ch);
  const data = out.data;

  const offXA = (cw - fromImg.width) >> 1;
  const offYA = ch - fromImg.height;
  const offXB = (cw - toImg.width)   >> 1;
  const offYB = ch - toImg.height;

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const idx = (y * cw + x) << 2;

      let distA =  1e9, colorA = [0,0,0,0];
      let lx = x - offXA, ly = y - offYA;
      if (lx >= 0 && ly >= 0 && lx < fromImg.width && ly < fromImg.height) {
        distA  = fromImg.sdf[ly][lx];
        colorA = fromImg.allColors[ly][lx];
      }

      let distB =  1e9, colorB = [0,0,0,0];
      lx = x - offXB; ly = y - offYB;
      if (lx >= 0 && ly >= 0 && lx < toImg.width && ly < toImg.height) {
        distB  = toImg.sdf[ly][lx];
        colorB = toImg.allColors[ly][lx];
      }

      const d = distA * (1 - t) + distB * t;
      if (d >= 0) { data[idx+3] = 0; continue; }

      const mix = [
        (1 - t) * colorA[0] + t * colorB[0],
        (1 - t) * colorA[1] + t * colorB[1],
        (1 - t) * colorA[2] + t * colorB[2],
        (1 - t) * colorA[3] + t * colorB[3],
      ];
      const c = nearestColorInPalette(mix, clampPalette);
      data[idx] = c[0]; data[idx+1] = c[1]; data[idx+2] = c[2]; data[idx+3] = c[3];
    }
  }
  ctx.putImageData(out, 0, 0);
}

export function generateImageData(img, topN = NUM_COLORS) {
  const { width: w, height: h } = img;
  const can = new OffscreenCanvas(w, h);
  const c   = can.getContext('2d', { willReadFrequently: true });
  c.drawImage(img, 0, 0);

  const d = c.getImageData(0, 0, w, h).data;
  const colours   = Array.from({ length: h }, () => Array(w));
  const inside    = new Uint8Array(w * h);
  const freq      = new Map();

  for (let i = 0; i < d.length; i += 4) {
    const idx = i >> 2, x = idx % w, y = idx / w | 0;
    const rgba = [d[i], d[i+1], d[i+2], d[i+3]];
    colours[y][x] = rgba;
    if (rgba[3] > 20) {
      inside[idx] = 1;
      const key = rgba.join(',');
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }

  const boundary = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = y * w + x;
    const inSide = inside[idx];
    for (let dy = -1; dy <= 1 && !boundary[idx]; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (inside[ny * w + nx] !== inSide) boundary.push({ x, y }), dy = 2;
      }
  }

  const sdf = Array.from({ length: h }, () => Array(w));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let min = 1e9;
    for (const b of boundary) {
      const dx = b.x - x, dy = b.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < min) min = d2;
    }
    sdf[y][x] = (inside[y * w + x] ? -1 : 1) * Math.sqrt(min);
  }

  const topNColours = [...freq]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k]) => k.split(',').map(n => +n));

  return { sdf, allColors: colours, topN: topNColours };
}
