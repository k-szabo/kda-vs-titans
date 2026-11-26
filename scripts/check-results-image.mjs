// Shareable results image checks (#52): model covers victory/defeat,
// daily/standard, W0 edge; renderer stays offline-safe (no external URLs).
// Run: node scripts/check-results-image.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const root = path.join(here, '..');
const src = fs.readFileSync(path.join(root, 'js', 'results-image.js'), 'utf8');

assert.match(src, /leaderLoadingArt/, 'model carries the leader portrait URL');
assert.match(src, /loadLeaderArt/, 'CORS-safe portrait loader with offline fallback');
assert.match(src, /crossOrigin = 'anonymous'/, 'portrait loads CORS-clean so PNG export stays untainted');
assert.ok(!src.includes('+ win ${'), 'no score-breakdown line on the card');

// Export UX (#52 follow-up): explicit clipboard-copy + PNG-download buttons,
// no OS share sheet (its "copy" moves a file reference most targets reject).
const uiSrc = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.ok(indexSrc.includes('btnCopyImage') && indexSrc.includes('btnSaveImage'), 'COPY IMAGE and SAVE PNG buttons exist');
assert.ok(!indexSrc.includes('btnExportImage'), 'share-sheet export button is gone');
assert.match(uiSrc, /new ClipboardItem\(\{ 'image\/png': blob \}\)/, 'image lands on the clipboard as PNG data');
assert.ok(!uiSrc.includes('navigator.share'), 'no OS share sheet in the export flow');
assert.ok(!/https?:\/\//.test(src), 'renderer must not reference external URLs');
assert.match(src, /RESULTS_IMAGE_SIZE = 1080/, 'square 1080 export');

const { buildResultsModel, formatRunTime } = await import('../js/results-image.js');

assert.equal(formatRunTime(3), '0:03', 'short run formats as m:ss');
assert.equal(formatRunTime(1527), '25:27', 'long run formats as mm:ss');
assert.equal(formatRunTime(3723), '1:02:03', 'hour run formats as h:mm:ss');

const base = (overrides = {}) => ({
  state: {
    wavesCleared: 10,
    runStatus: 'victory',
    leader: 'ahri',
    encoreLevel: 0,
    cardPlayCounts: { seraphine_encore: 4 },
    peakSingleTurnDamage: 70,
    merchTokens: 12,
    startedAt: Date.now() - 1527000,
    dailyChallenge: { date: '2026-11-26', modifier: 'acoustic_set' },
    dailyScore: 32070,
    dailyScoreParts: { wavePts: 30000, victoryPts: 2000, peakPts: 70, speedPts: 0 },
    ...overrides
  },
  cardDatabase: { seraphine_encore: { name: 'Harmonic Resonance' } },
  encounters: Array.from({ length: 10 }, (_, i) => ({ name: `W${i + 1}` })),
  leaderName: 'Ahri',
  version: 'v1.34.0_test',
  isVictory: true,
  now: Date.now()
});

const artModel = buildResultsModel({ ...base(), leaderLoadingArt: 'https://example.invalid/loading/Ahri_15.jpg' });
assert.equal(artModel.leaderLoadingArt, 'https://example.invalid/loading/Ahri_15.jpg', 'portrait URL passes through the model');

const victory = buildResultsModel(base());
assert.equal(victory.title, 'ENCORE VICTORY!', 'victory title');
assert.equal(victory.score, 32070, 'daily score carried into the model');
assert.equal(victory.mostPlayed, 'Harmonic Resonance (4)', 'most-played resolves names');
assert.equal(victory.modeLabel, 'DAILY 2026-11-26 UTC', 'daily mode label');

const defeatModel = buildResultsModel({ ...base(), state: { ...base().state, wavesCleared: 0, runStatus: 'defeat', dailyScore: 0, dailyScoreParts: { wavePts: 0, victoryPts: 0, peakPts: 0, speedPts: 0 } }, isVictory: false });
assert.equal(defeatModel.title, 'STAGE COLLAPSED', 'defeat title');
assert.equal(defeatModel.score, 0, 'W0 defeat exports 0');
assert.equal(defeatModel.wavesCleared, 0, 'W0 defeat keeps zero waves');

const standard = buildResultsModel({ ...base(), state: { ...base().state, dailyChallenge: undefined, dailyScore: undefined, dailyScoreParts: undefined }, isVictory: true });
assert.equal(standard.score, null, 'standard runs export no daily score');
assert.equal(standard.modeLabel, 'ENCORE 0', 'standard mode falls back to encore tier');

console.log('PASS: results image model is share-ready.');
