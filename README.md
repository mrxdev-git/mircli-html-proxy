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

## Headful on a Linux VPS (no GUI) — Ubuntu 22.04/22.04.4 LTS

You can run headful Chrome on a server without a desktop using a virtual X server (Xvfb).

1. Install system dependencies

   ```bash
   sudo apt-get update && sudo apt-get install -y \
     xvfb xauth x11-apps \
     libnss3 libnspr4 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 \
     libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
     libgtk-3-0 libasound2 fonts-liberation libu2f-udev xdg-utils libvulkan1 ca-certificates
   ```

1. Fastest way (xvfb-run wrapper)

   ```bash
   xvfb-run -a --server-args="-screen 0 1440x900x24" \
     node index.js https://mircli.ru -- --headless=false --timeout=30000 --wait=1500 --out=mircli.html
   ```

   Or use the convenience npm script (forwards args after `--`):

   ```bash
   npm run headful:vps -- https://mircli.ru --timeout=30000 --wait=1500 --out=mircli.html
   ```

1. Manual Xvfb session (if you need more control)

   ```bash
   Xvfb :99 -screen 0 1440x900x24 &
   export DISPLAY=:99

   node index.js https://mircli.ru -- --headless=false --timeout=30000 --wait=1500 --out=mircli.html

   # when done
   killall Xvfb || true
   ```

Tips:

- If you hit Chromium sandbox errors on VPS kernels, enable user namespaces:

  ```bash
  sudo sysctl -w kernel.unprivileged_userns_clone=1
  ```

  Persist across reboots:

  ```bash
  echo 'kernel.unprivileged_userns_clone=1' | sudo tee /etc/sysctl.d/99-chrome.conf
  sudo sysctl --system
  ```
- Alternatively, you can add `--no-sandbox` to Chrome args in `index.js` (less secure). Look for `chromeArgs` and append it there.
