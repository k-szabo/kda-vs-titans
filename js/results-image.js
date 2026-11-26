// Shareable end-of-run results image (1080x1080 PNG, GeoGuessr-style).
// Pure model builder (testable in Node) + canvas renderer (browser only).
// The leader portrait is the Data Dragon *loading* art (portrait ratio,
// CORS-open), drawn only when the caller hands over a loaded image —
// offline the renderer falls back to an initial medallion, so export
// never depends on the network and the canvas is never tainted.
export const RESULTS_IMAGE_SIZE = 1080;

export function formatRunTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return `${hours > 0 ? `${hours}:` : ''}${mm}:${String(rest).padStart(2, '0')}`;
}

export function buildResultsModel({ state, cardDatabase, encounters, leaderName, leaderLoadingArt, version, isVictory, now = Date.now() }) {
  const wavesCleared = state?.wavesCleared || 0;
  const wavesTotal = Array.isArray(encounters) ? encounters.length : 10;
  const mostPlayedEntry = Object.entries(state?.cardPlayCounts || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const seconds = Math.max(1, Math.round((now - (state?.startedAt || now)) / 1000));
  return {
    size: RESULTS_IMAGE_SIZE,
    title: isVictory ? 'ENCORE VICTORY!' : 'STAGE COLLAPSED',
    subtitle: isVictory ? 'SETLIST COMPLETE // WORLD TOUR SAVED' : 'STAGE OVERWHELMED',
    leaderName: leaderName || state?.leader || '—',
    modeLabel: state?.dailyChallenge
      ? `DAILY ${state.dailyChallenge.date} UTC`
      : `ENCORE ${state?.encoreLevel ?? 0}`,
    wavesCleared,
    wavesTotal,
    score: state?.dailyChallenge ? (state?.dailyScore ?? null) : null,
    leaderLoadingArt: leaderLoadingArt || null,
    mostPlayed: mostPlayedEntry
      ? `${cardDatabase?.[mostPlayedEntry[0]]?.name || mostPlayedEntry[0]} (${mostPlayedEntry[1]})`
      : '—',
    peakDamage: state?.peakSingleTurnDamage || 0,
    runTime: formatRunTime(seconds),
    tokens: state?.merchTokens ?? 0,
    isVictory: isVictory === true,
    version: version || '',
    date: state?.dailyChallenge?.date || new Date(now).toISOString().slice(0, 10)
  };
}

function fitSingleLine(ctx, text, maxWidth, maxFont = 30, minFont = 22) {
  let size = maxFont;
  ctx.font = `900 ${size}px Arial, sans-serif`;
  if (ctx.measureText(text).width <= maxWidth) return { text, size };
  while (size > minFont) {
    size -= 2;
    ctx.font = `900 ${size}px Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) return { text, size };
  }
  let short = text;
  while (short.length > 4 && ctx.measureText(`${short}…`).width > maxWidth) short = short.slice(0, -1);
  return { text: `${short}…`, size: minFont };
}

function roundRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function renderResultsImage(model, artImage = null) {
  const size = RESULTS_IMAGE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#160826');
  bg.addColorStop(0.55, '#241040');
  bg.addColorStop(1, '#0b1e3a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Neon glow accents.
  const glow = (x, y, radius, color) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };
  glow(size * 0.15, size * 0.12, 320, 'rgba(236,72,153,0.35)');
  glow(size * 0.9, size * 0.85, 380, 'rgba(34,211,238,0.30)');

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f9a8d4';
  ctx.font = '700 34px Arial, sans-serif';
  ctx.fillText('K/DA // ENCORE SPIRE', size / 2, 92);

  ctx.fillStyle = model.isVictory ? '#6ee7b7' : '#fda4af';
  ctx.font = '900 64px Arial, sans-serif';
  ctx.fillText(model.title, size / 2, 178);

  ctx.fillStyle = '#cbd5e1';
  ctx.font = '700 26px Arial, sans-serif';
  ctx.fillText(model.subtitle, size / 2, 220);
  ctx.fillText(`${model.leaderName}  •  ${model.modeLabel}`, size / 2, 258);

  // Leader portrait column (GeoGuessr-style side art): the Data Dragon
  // loading art fits the frame exactly (308x560 ratio); offline fallback
  // is a neon initial medallion. Caller-owned image = never tainted.
  const frameX = 90;
  const frameY = 300;
  const frameW = 340;
  const frameH = 620;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, frameX, frameY, frameW, frameH, 28);
  ctx.fill();
  if (artImage) {
    ctx.save();
    roundRect(ctx, frameX, frameY, frameW, frameH, 28);
    ctx.clip();
    const scale = Math.max(frameW / artImage.width, frameH / artImage.height);
    const dw = artImage.width * scale;
    const dh = artImage.height * scale;
    ctx.drawImage(artImage, frameX + (frameW - dw) / 2, frameY + (frameH - dh) / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.fillStyle = model.isVictory ? '#10b981' : '#e879a0';
    ctx.beginPath();
    ctx.arc(frameX + frameW / 2, frameY + frameH / 2 - 30, 110, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 130px Arial, sans-serif';
    ctx.fillText(String(model.leaderName || '—').slice(0, 1).toUpperCase(), frameX + frameW / 2, frameY + frameH / 2 + 18);
  }
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(249,168,212,0.6)';
  roundRect(ctx, frameX, frameY, frameW, frameH, 28);
  ctx.stroke();

  // Right column: wave dots + stats card.
  const cx = 735;
  const dots = Math.max(1, model.wavesTotal);
  const dotRadius = 20;
  const gap = Math.min(52, 500 / dots);
  const startX = cx - (gap * (dots - 1)) / 2;
  const dotY = 352;
  for (let index = 0; index < dots; index++) {
    const x = startX + index * gap;
    const cleared = index < model.wavesCleared;
    ctx.beginPath();
    ctx.arc(x, dotY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = cleared ? (model.isVictory ? '#10b981' : '#e879a0') : 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = cleared ? '#ffffff' : 'rgba(255,255,255,0.35)';
    ctx.stroke();
    ctx.fillStyle = cleared ? '#ffffff' : 'rgba(255,255,255,0.55)';
    ctx.font = '900 20px Arial, sans-serif';
    ctx.fillText(String(index + 1), x, dotY + 7);
  }
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '700 28px Arial, sans-serif';
  const extra = Math.max(0, model.wavesCleared - dots);
  ctx.fillText(
    extra > 0 ? `WAVES ${model.wavesCleared} / ${dots} (+${extra} ENDLESS)` : `WAVES ${model.wavesCleared} / ${dots}`,
    cx,
    dotY + 62
  );

  // Stats card.
  const cardX = 480;
  const cardW = 510;
  const cardY = 452;
  const cardH = 460;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(249,168,212,0.5)';
  roundRect(ctx, cardX, cardY, cardW, cardH, 28);
  ctx.stroke();

  const rows = model.score == null
    ? [
      ['MOST-PLAYED', model.mostPlayed],
      ['PEAK DAMAGE', String(model.peakDamage)],
      ['RUN TIME', model.runTime],
      ['MERCH TOKENS', String(model.tokens)]
    ]
    : [
      ['DAILY SCORE', String(model.score)],
      ['MOST-PLAYED', model.mostPlayed],
      ['PEAK DAMAGE', String(model.peakDamage)],
      ['RUN TIME', model.runTime]
    ];
  rows.forEach(([label, value], index) => {
    const y = cardY + 62 + index * 104;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f9a8d4';
    ctx.font = '700 22px Arial, sans-serif';
    ctx.fillText(label, cardX + 40, y);
    const fitted = fitSingleLine(ctx, String(value), cardW - 80);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${fitted.size}px Arial, sans-serif`;
    ctx.fillText(fitted.text, cardX + 40, y + 42);
  });

  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(203,213,225,0.9)';
  ctx.font = '400 26px Arial, sans-serif';
  ctx.fillText(`${model.date}  •  ${model.version}  •  k-szabo.github.io/kda-vs-titans`, size / 2, size - 72);

  return canvas;
}

// Loads the leader portrait for the results card. Data Dragon serves
// Access-Control-Allow-Origin: *, so a crossOrigin="anonymous" image keeps
// the canvas clean for PNG export. Resolves null when offline or slow.
export function loadLeaderArt(url, timeoutMs = 6000) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    let settled = false;
    const done = (art) => { if (!settled) { settled = true; resolve(art); } };
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => done(img);
      img.onerror = () => done(null);
      setTimeout(() => done(null), timeoutMs);
      img.src = url;
    } catch { done(null); }
  });
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG export failed.'));
    }, 'image/png');
  });
}
