// Daily scoring rules (#53): W0 defeat = 0, waves-dominant formula,
// caps and board ordering consistent across client, SQL, and Edge Function.
// Run: node scripts/check-leaderboard.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const root = path.join(here, '..');

const leaderboard = fs.readFileSync(path.join(root, 'js', 'leaderboard.js'), 'utf8');
const ordering = fs.readFileSync(path.join(root, 'supabase', '202611260001_fix_board_ordering.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase', 'functions', 'daily-leaderboard', 'index.ts'), 'utf8');

// Client rules present.
assert.match(leaderboard, /wavePoints: 3000/, 'waves dominate (3000/wave)');
assert.match(leaderboard, /victoryBonus: 2000/, 'victory bonus 2000');
assert.match(leaderboard, /maxPeakBonus: 300/, 'peak capped at 300');
assert.match(leaderboard, /maxSpeedBonus: 300/, 'speed capped at 300');
assert.match(leaderboard, /speedWindowSeconds: 900/, 'speed window 900s');
assert.match(leaderboard, /maxScore: 99999/, 'client max score 99999');
assert.match(leaderboard, /waves === 0 && !won/, 'W0 defeat scores 0');

// Caps match across layers.
assert.match(ordering, /score between 0 and 99999/, 'SQL table cap 99999');
assert.match(ordering, /p_score > 99999/, 'SQL validator cap 99999');
assert.match(edge, /integer\(body\.score,0,99999\)/, 'edge cap 99999');

// Board ranks waves-first, then victory, then score, then time.
assert.match(ordering, /order by s\.waves desc, s\.victory desc, s\.score desc, s\.seconds asc/si, 'daily board waves-first ordering');

// Property test of the formula (mirrors computeDailyScore).
function score({ waves, victory, peak, seconds }) {
  if (waves === 0 && !victory) return 0;
  return waves * 3000 + (victory ? 2000 : 0) + Math.min(Math.max(0, peak), 300) + Math.min(Math.max(0, 900 - seconds), 300);
}
// Ticket acceptance: W0 instant loss = 0, slow W10 victory is tens of thousands ahead.
assert.equal(score({ waves: 0, victory: false, peak: 0, seconds: 3 }), 0, 'W0 defeat is 0');
const slowWin = score({ waves: 10, victory: true, peak: 70, seconds: 1527 });
assert.ok(slowWin > 32000 && slowWin < 32700, `slow W10 victory ~32070 (got ${slowWin})`);
// One extra wave always beats any speed/peak bonus below it.
for (let w = 0; w < 10; w++) {
  const lowerMax = score({ waves: w, victory: true, peak: 9999, seconds: 1 });
  const upperMin = score({ waves: w + 1, victory: false, peak: 0, seconds: 86400 });
  assert.ok(upperMin > lowerMax, `W${w + 1} defeat min (${upperMin}) beats W${w} victory max (${lowerMax})`);
}
// Same waves: victory beats defeat; same outcome: faster beats slower by a small delta.
assert.ok(score({ waves: 5, victory: true, peak: 0, seconds: 86400 }) > score({ waves: 5, victory: false, peak: 300, seconds: 1 }), 'victory beats defeat at same waves');
assert.ok(score({ waves: 10, victory: true, peak: 70, seconds: 600 }) - slowWin <= 300, 'speed matters only within 300 pts');

console.log('PASS: daily scoring is waves-dominant with W0 = 0.');
