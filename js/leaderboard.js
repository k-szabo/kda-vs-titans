// Daily leaderboard client: Supabase Edge Function gateway + anonymous Auth.
// All network failures degrade to {error} results; the game stays playable
// without configuration or connectivity.

const SESSION_KEY = 'kda-vs-titans:lb-session';
const BOARD_CACHE_MS = 60000;
const boardCache = new Map();
let cachedConfig = null;
let configLoaded = false;

export async function getBoardConfig() {
  if (configLoaded) return cachedConfig;
  configLoaded = true;
  try {
    const manifest = await (await fetch('assets/config/leaderboard.json', { cache: 'no-store' })).json();
    if (!manifest || typeof manifest.url !== 'string' || !manifest.url || typeof manifest.function !== 'string' || !manifest.function) return null;
    let publishableKey = '';
    try {
      const keyFile = await (await fetch(manifest.keyFile, { cache: 'no-store' })).json();
      publishableKey = typeof keyFile?.publishableKey === 'string' ? keyFile.publishableKey : '';
    } catch {
      return null;
    }
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) return null;
    cachedConfig = { url: manifest.url.replace(/\/$/, ''), publishableKey, fn: manifest.function };
    return cachedConfig;
  } catch {
    return null;
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || typeof session.access_token !== 'string') return null;
    return session;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch { /* storage unavailable: session stays in memory only */ }
}

async function authRequest(config, path, body) {
  const response = await fetch(`${config.url}${path}`, {
    method: 'POST',
    headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!data || typeof data.access_token !== 'string') return null;
  return data;
}

export async function ensurePlayerToken() {
  const config = await getBoardConfig();
  if (!config) return null;
  const now = Math.floor(Date.now() / 1000);
  const existing = loadSession();
  if (existing && Number.isFinite(existing.expires_at) && existing.expires_at - 60 > now && existing.access_token) {
    return existing.access_token;
  }
  try {
    const refreshed = existing?.refresh_token
      ? await authRequest(config, '/auth/v1/token?grant_type=refresh_token', { refresh_token: existing.refresh_token })
      : null;
    const session = refreshed || await authRequest(config, '/auth/v1/signup', { data: {}, gotrue_meta_security: {} });
    if (!session) return null;
    const stored = {
      access_token: session.access_token,
      refresh_token: session.refresh_token || existing?.refresh_token || null,
      expires_at: now + (Number.isFinite(session.expires_in) ? session.expires_in : 3600)
    };
    saveSession(stored);
    return stored.access_token;
  } catch {
    return null;
  }
}

async function gateway(path, token, body) {
  const config = await getBoardConfig();
  if (!config) return { error: 'unavailable' };
  try {
    const response = await fetch(`${config.url}/functions/v1/${config.fn}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        apikey: config.publishableKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    if (response.status === 204) return {};
    let data = null;
    try { data = await response.json(); } catch { return { error: 'unavailable' }; }
    if (!response.ok) return { error: typeof data?.error === 'string' ? data.error : 'unavailable' };
    return data;
  } catch {
    return { error: 'offline' };
  }
}

export async function fetchBoard(period, date) {
  const key = `${period}:${date}`;
  const cached = boardCache.get(key);
  if (cached && Date.now() - cached.at < BOARD_CACHE_MS) return cached.data;
  const data = await gateway(`?period=${encodeURIComponent(period)}&date=${encodeURIComponent(date)}`, null);
  if (!data.error) boardCache.set(key, { at: Date.now(), data });
  return data;
}

export async function submitDailyScore(payload) {
  const token = await ensurePlayerToken();
  if (!token) return { error: 'offline' };
  return gateway('', token, payload);
}

export async function checkCrowns() {
  const token = await ensurePlayerToken();
  if (!token) return { error: 'offline' };
  return gateway('?crowns=1', token);
}

export function getMostPlayedCard(cardPlayCounts, cardDatabase) {
  const entries = Object.entries(cardPlayCounts || {}).filter(([, count]) => count > 0);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [cardId, count] = entries[0];
  return { cardId, name: cardDatabase[cardId]?.name || cardId, count };
}

export function buildScorePayload(state, cardDatabase, version, now = Date.now()) {
  const seconds = Math.max(1, Math.round((now - state.startedAt) / 1000));
  const mostPlayed = getMostPlayedCard(state.cardPlayCounts, cardDatabase);
  const victory = state.runStatus === 'victory';
  const score = state.wavesCleared * 100 + (victory ? 500 : 0) +
    (state.peakSingleTurnDamage || 0) + Math.max(0, 1800 - seconds);
  return {
    score,
    waves: state.wavesCleared,
    victory,
    leader: state.leader,
    encore: state.encoreLevel,
    seconds,
    mostPlayed: mostPlayed ? mostPlayed.name : '—',
    mostPlayedCount: mostPlayed ? mostPlayed.count : 0,
    version
  };
}
