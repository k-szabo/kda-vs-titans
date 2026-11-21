# Daily leaderboard backend (Supabase)

This is an optional backend for the static game. It stores community Daily World Tour scores; it does not replay or authoritatively simulate runs. Boards degrade to an "unavailable" notice when unconfigured or offline.

## Dashboard deployment (dedicated project)

This backend lives in its **own Supabase project** (separate from any other game) so neither side can affect the other.

1. Create a new project and note its URL plus the `sb_publishable_…` key.
2. Enable anonymous sign-ins under **Authentication → Sign In / Providers**. New sign-ups must also be allowed.
3. Open **SQL Editor → New query**. Paste the complete contents of `202611210001_kda_daily_leaderboard.sql` and run it. This creates a private `kda_private` schema, score and rate-limit tables, and narrowly granted public RPC functions. It does not read or reset any game saves.
4. Open **Edge Functions → Deploy a new function → Via Editor**, name it `daily-leaderboard`, use the complete contents of `functions/daily-leaderboard/index.ts` as its `index.ts`. Deploy it.
5. In that function's configuration, turn off the platform **Verify JWT** check. Public reads and preflight need this; POST still requires a user JWT that the function verifies with Supabase Auth.
6. Add the Edge Function secret `ALLOWED_ORIGINS` as a comma-separated list of exact browser origins. The defaults are `https://k-szabo.github.io`, `http://localhost:8000`, `http://127.0.0.1:8000`. An origin contains no trailing slash or project path.
7. Set the repo Actions variable `SUPABASE_PUBLISHABLE_KEY` to the project's publishable key, flip Pages to GitHub Actions, and fill `assets/config/leaderboard.json` with the project URL (see `scripts/write-leaderboard-config.mjs`).

Anonymous users are tied to their browser session; clearing browser data creates a new player identity. Do not delete anonymous Auth users as routine cleanup: their score rows are deleted by the foreign-key cascade.

## API contract

Endpoint: `<PROJECT_URL>/functions/v1/daily-leaderboard`.

Every browser call sends the project's public publishable key in `apikey`. POST also sends `Authorization: Bearer <user-access-token>`; an API key is never a user token.

- `GET ?period=daily|weekly|monthly&date=YYYY-MM-DD`: returns `{scores:[...], range:[start,end]}` with at most 100 rows. Daily rows carry rank, name, score, waves, victory, leader, encore, seconds, most-played card + count, and submission time. Period rows carry rank, name, total, games, and wins. No user IDs or Auth records are exposed.
- `POST`: exact JSON fields `{name,day,score,waves,victory,leader,encore,seconds,mostPlayed,mostPlayedCount,version}`. Returns `{ok:true,improved}`. Rules: one personal best per user per day; a worse result may update the name but never replaces the stored best; a valid submission is allowed once per 60 seconds.
- Error codes: `unauthorized` (401), `origin_denied` (403), `invalid_name`/`invalid_score` (400), `rate_limited` (429 with `Retry-After: 60`), `unavailable` (503). Unsupported content type is 415, oversized JSON is 413, unsupported method is 405.

Names allow 3–16 Unicode letters/numbers, spaces, `_` and `-`, with no surrounding whitespace. Scores require waves 0–10, Encore 0–5, a known leader, 1–86400 seconds, and a day within ±1 of today. These are storage/abuse bounds, not proof that a score was achieved honestly.

## Git-free browser configuration

The publishable key is not committed. In GitHub set **Settings → Secrets and variables → Actions → Variables → New repository variable** named `SUPABASE_PUBLISHABLE_KEY` with the `sb_publishable_…` value. The Pages job writes it into the deployment artifact. The published browser can read this value; it is not a secret, and RLS/RPC grants remain necessary.

Locally set the same process environment variable and run `node scripts/write-leaderboard-config.mjs`. This creates the ignored `assets/config/leaderboard-public.json`; never stage it. The generator rejects secret API keys. Database passwords, service keys and user tokens must never be supplied as repository variables or browser configuration.

## Verification (run against the real project after setup)

1. Public GET for today returns `{scores: []}` with the production origin; other origins get `origin_denied`.
2. An invalid score returns `invalid_score` without creating a row; an unauthenticated RPC call is denied.
3. A real anonymous player submission lands on the board; a worse same-day replay returns `improved:false` and keeps the best row; rapid replays return `rate_limited`.
4. Weekly/monthly tabs equal the summed dailies for the period (seed two days to check).
5. With no configuration file, the game still runs and the board shows its unavailable message.
