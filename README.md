# mircli-cdp-grabber

A fast, stealthy Puppeteer-based HTML grabber that opens a page like a real user, waits briefly for JS rendering, and saves the final HTML.

## Install

```bash
# Node 18+ recommended
npm i
```

## Quick start

```bash
# Headless, quick output (recommended)
node index.js https://mircli.ru -- --headless=true --timeout=30000 --wait=1500 --out=mircli.html

# Headful (visible Chrome window), still exits fast
node index.js https://mircli.ru -- --headless=false --timeout=30000 --wait=1500 --out=mircli.html

# Using --url instead of positional
node index.js --url=https://mircli.ru -- --headless=true --out=mircli.html
```

The script writes:
- An early snapshot right after DOMContentLoaded (fast guarantee).
- A final snapshot after a very short quiet period (overwrites the early file).

## CLI options

- `--url` (string): Target URL. Alternatively pass it as the first positional argument.
- `--headless` (string): One of `true | false | new`. Default: `false`.
- `--proxy` (string): HTTP/HTTPS proxy, e.g. `http://user:pass@host:port`.
- `--userdata` (string): Chrome user data dir. Default: `~/.mircli-chrome-profile`.
- `--timeout` (number): Global timeout in ms. Default: `60000`.
- `--wait` (number): Extra quiet/settle time in ms after network idle (internally clamped small). Default: `7000`.
- `--out` (string): Output HTML path. Default: `mircli.html`.
- `--stayopen` (boolean): Keep the browser open after saving (useful in headful). Default: `false`.

Examples:
```bash
# Minimal
node index.js https://example.com

# With proxy
node index.js https://example.com -- --proxy=http://127.0.0.1:8888 --headless=true

# Keep window after save (inspect state)
node index.js https://example.com -- --headless=false --stayopen=true
```

## Environment variables

- `CHROME_PATH`: Path to Chrome/Chromium executable (overrides auto-detection).
- `MIRCLI_HEADLESS`: Default for `--headless` (`true | false | new`).
- `HTTP_PROXY` / `PROXY`: Default proxy for `--proxy`.
- `USER_DATA_DIR`: Default for `--userdata`.

## How it works (brief)

- Uses `puppeteer-extra` with `stealth` plugin and several hardening patches.
- Prefers Puppeteer’s bundled Chromium for consistency; falls back to system Chrome if needed.
- Navigates to the URL, ensures `body` exists, saves an early snapshot, performs a short human-like scroll, then waits very briefly:
  - A short network idle-like window (ignores long-lived WebSockets/EventSource).
  - A short DOM quiet period using `MutationObserver`.
- Saves the final HTML (overwriting the early snapshot), and exits unless `--stayopen`.

## Tips

- Increase `--timeout` slightly if your target is slow; the internal waits remain short.
- If you need a clean profile per run, pass a temp dir to `--userdata`.
- Set `CHROME_PATH` if you prefer your system Chrome.

## Troubleshooting

- If you see `Target closed` or `disconnected`, the early snapshot ensures you still get an output. Re-run with `--headless=false` to observe the page.
- Use `--stayopen=true` to inspect the final state before exit.
- Check console logs printed by the script for site-side errors or anti-bot challenges.
