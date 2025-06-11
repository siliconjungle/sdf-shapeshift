import React, { useState, useEffect, useRef, useCallback } from 'react';
import styles from './sdf-morph.module.css';
import {
  NUM_COLORS,
  generateImageData,
  drawImageBottomCenter,
  unionPalettes,
  nearestColorInPalette,
} from '../lib/sdf-morph';

const FRAMES = 15;
const FPS    = 20;
const QUANT  = 1;            // ← fixed at full palette clamp

export default function SdfMorphDemo() {
  const [imgA, setImgA] = useState(null);
  const [imgB, setImgB] = useState(null);
  const [dir , setDir ] = useState(true);       // true = A→B
  const [frame, setFrame] = useState(1);
  const [playing, setPlaying] = useState(false);

  const canvasRef = useRef(null);
  const inA = useRef(null);
  const inB = useRef(null);

  /* ── image loader ────────────────────────────── */
  const load = useCallback((file, setter) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () =>
      setter({ url, width: img.width, height: img.height, ...generateImageData(img, NUM_COLORS) });
    img.src = url;
  }, []);

  /* ── per-frame renderer (unchanged except quant=1) ───────── */
  const render = useCallback((f, from, to, ctx) => {
    const cw = Math.max(from.width, to.width);
    const ch = Math.max(from.height, to.height);
    ctx.canvas.width = cw; ctx.canvas.height = ch;
    ctx.clearRect(0, 0, cw, ch);

    const t = (f - 1) / (FRAMES - 1);

    if (f === 1)       return drawImageBottomCenter(ctx, from.url, from.width, from.height, cw, ch);
    if (f === FRAMES)  return drawImageBottomCenter(ctx, to.url,   to.width,   to.height,   cw, ch);

    const pal =
      f <= 6 ? from.topN :
      f <= 9 ? unionPalettes(from.topN, to.topN) :
               to.topN;

    const img = ctx.createImageData(cw, ch);
    const d   = img.data;

    const oXA = (cw - from.width) >> 1, oYA = ch - from.height;
    const oXB = (cw - to.width)   >> 1, oYB = ch - to.height;

    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) << 2;

        let sdA = 1e9, cA = [0,0,0,0];
        let lx = x - oXA, ly = y - oYA;
        if (lx>=0 && ly>=0 && lx<from.width && ly<from.height) {
          sdA = from.sdf[ly][lx]; cA = from.allColors[ly][lx];
        }
        let sdB = 1e9, cB = [0,0,0,0];
        lx = x - oXB; ly = y - oYB;
        if (lx>=0 && ly>=0 && lx<to.width && ly<to.height) {
          sdB = to.sdf[ly][lx]; cB = to.allColors[ly][lx];
        }

        const sd = sdA*(1-t) + sdB*t;
        if (sd >= 0) { d[i+3] = 0; continue; }

        const blend = [
          (1-t)*cA[0] + t*cB[0],
          (1-t)*cA[1] + t*cB[1],
          (1-t)*cA[2] + t*cB[2],
          (1-t)*cA[3] + t*cB[3],
        ];
        const palC = nearestColorInPalette(blend, pal);

        d[i+0] = palC[0];
        d[i+1] = palC[1];
        d[i+2] = palC[2];
        d[i+3] = palC[3];
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);

  /* ── playback loop ───────────────────────────── */
  const play = () => {
    if (!imgA || !imgB || playing) return;
    setDir(d => !d);
    setFrame(1);
    setPlaying(true);
  };

  useEffect(() => {
    if (!playing) return;
    const ctx   = canvasRef.current.getContext('2d', { willReadFrequently:true });
    const from  = dir ? imgA : imgB;
    const to    = dir ? imgB : imgA;
    render(frame, from, to, ctx);

    if (frame >= FRAMES) { setPlaying(false); return; }
    const id = setTimeout(() => setFrame(f => f + 1), 1000 / FPS);
    return () => clearTimeout(id);
  }, [playing, frame, dir, imgA, imgB, render]);

  /* ── spritesheet (A→B, quant=1) ─────────────── */
  const downloadSheet = () => {
    if (!imgA || !imgB) return;
    const cw = Math.max(imgA.width, imgB.width);
    const ch = Math.max(imgA.height, imgB.height);
    const sheet = new OffscreenCanvas(cw * FRAMES, ch);
    const sctx  = sheet.getContext('2d');
    const tmp   = document.createElement('canvas').getContext('2d');

    for (let f = 1; f <= FRAMES; f++) {
      render(f, imgA, imgB, tmp);
      sctx.drawImage(tmp.canvas, (f - 1) * cw, 0);
    }
    sheet.convertToBlob().then(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'spritesheet.png';
      a.click(); URL.revokeObjectURL(a.href);
    });
  };

  const ready = imgA && imgB;

  /* ── UI ─────────────────────────────────────── */
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>SDF Shapeshift</h1>
      <p className={styles.tagline}>Drop two sprites, morph, export sheet.</p>

      <div className={styles.editor}>
        <Drop label="Image A" img={imgA} pick={f => load(f, setImgA)} inputRef={inA}/>
        <Drop label="Image B" img={imgB} pick={f => load(f, setImgB)} inputRef={inB}/>
      </div>

      {ready && (
        <div className={styles.card}>
          <canvas ref={canvasRef} className={styles.canvas}/>
          <div className={styles.ctrlRow}>
            <button className={styles.ctrl} onClick={play}>Play</button>
            <button className={styles.ctrl} onClick={downloadSheet}>Download</button>
          </div>
        </div>
      )}
    </main>
  );
}

/* ── drop zone ───────────────────────────────── */
function Drop({ label, img, pick, inputRef }) {
  const [over, setOver] = useState(false);
  const stop = e => { e.preventDefault(); e.stopPropagation(); };

  return (
    <div className={styles.zoneWrap}>
      <div
        className={`${styles.zone} ${over ? styles.zoneOver : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { stop(e); setOver(true);} }
        onDragLeave={e => { stop(e); setOver(false);} }
        onDrop={e => { stop(e); setOver(false); e.dataTransfer.files[0] && pick(e.dataTransfer.files[0]); }}
      >
        {img ? <img src={img.url} alt="" className={styles.preview}/> : label}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className={styles.zoneInput}
          onChange={e => e.target.files[0] && pick(e.target.files[0])}
        />
      </div>
      {img && <small className={styles.dim}>{img.width}×{img.height}</small>}
    </div>
  );
}
