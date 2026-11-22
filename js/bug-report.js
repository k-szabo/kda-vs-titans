// Public Tally intake form; never exports saves or raw browser/session data.
//
// ENDPOINT STATUS: placeholder. Replace ONLY the form ID below with the real
// K/DA report form ID from Tally (https://tally.so/r/<form-id>) once the form
// exists. The hidden-field contract (version, leader, wave, encore, browser,
// viewport, pixel_ratio) must match the form's hidden fields exactly.
export const BUG_REPORT_ENDPOINT = 'https://tally.so/r/7XNo5L';

const BROWSER_PATTERNS = [
  [/(?:Edg|EdgA|EdgiOS)\/(\d+)/, 'Edge'],
  [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/(?:OPR|OPiOS)\/(\d+)/, 'Opera'],
  [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/Version\/(\d+).*Safari\//, 'Safari']
];

export function browserName(userAgent = '') {
  for (const [pattern, name] of BROWSER_PATTERNS) {
    const match = String(userAgent).match(pattern);
    if (match) return `${name} ${match[1]}`;
  }
  return 'Unknown';
}

function viewportSize(view) {
  const width = Math.round(view?.innerWidth || 0);
  const height = Math.round(view?.innerHeight || 0);
  return `${width} × ${height}`;
}

function pixelRatio(view) {
  return Number(view?.devicePixelRatio || 1).toFixed(2);
}

// context: { version, leader|null, waveIndex|null, encoreLevel, userAgent, view }
// leader/waveIndex are set only while a run is active; otherwise the report
// is filed from the menu and those fields read 'menu'.
export function createBugReportURL(context = {}) {
  const url = new URL(BUG_REPORT_ENDPOINT);
  const inRun = Boolean(context.leader) && Number.isInteger(context.waveIndex);
  const fields = {
    version: context.version || 'unknown',
    leader: inRun ? context.leader : 'menu',
    wave: inRun ? `W${context.waveIndex + 1}` : 'menu',
    encore: inRun ? `E${context.encoreLevel || 0}` : 'menu',
    browser: browserName(context.userAgent),
    viewport: viewportSize(context.view),
    pixel_ratio: pixelRatio(context.view)
  };
  for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
  return url.href;
}

// getContext() is called on every focus/click, so links always carry live
// run state. Never pass saves, storage, page URLs, or raw user agents here —
// only the scalar fields createBugReportURL reads.
export function initBugReportLinks(getContext) {
  const links = Array.from(document.querySelectorAll('[data-bug-report]'));
  const refresh = (link) => {
    try {
      link.href = createBugReportURL(getContext());
    } catch {
      link.href = BUG_REPORT_ENDPOINT;
    }
    link.setAttribute('aria-label', 'Open the bug report form in a new tab');
  };
  for (const link of links) {
    refresh(link);
    for (const event of ['focus', 'pointerdown', 'click']) link.addEventListener(event, () => refresh(link));
  }
}
