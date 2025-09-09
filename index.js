/* eslint-disable no-console */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { executablePath as chromiumExecutablePath } from 'puppeteer';
import { launch as launchChrome } from 'chrome-launcher';

// ---------- CLI ----------
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [url]')
  .option('url', { type: 'string', describe: 'Target URL' })
  .option('headless', { type: 'string', default: process.env.MIRCLI_HEADLESS || 'false', describe: 'true | false | new' })
  .option('proxy', { type: 'string', default: process.env.HTTP_PROXY || process.env.PROXY || '' })
  .option('userdata', { type: 'string', default: process.env.USER_DATA_DIR || path.join(os.homedir(), '.mircli-chrome-profile') })
  .option('timeout', { type: 'number', default: 60_000 })
  .option('wait', { type: 'number', default: 7_000, describe: 'Extra settle wait (ms) after network idle' })
  .option('out', { type: 'string', default: 'mircli.html' })
  .option('stayopen', { type: 'boolean', default: false, describe: 'Keep browser open after saving (headful only)' })
  .help().argv;

// ---------- Stealth & hardening ----------
puppeteer.use(StealthPlugin());

// Some stealth plugins benefit from explicit MIME/codecs settings via CDP override,
// plus we’ll add several evaluateOnNewDocument patches for stricter mimicry.
const PATCHES = `
(() => {
  // webdriver
  Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined });

  // languages
  Object.defineProperty(navigator, 'languages', { get: () => ['ru-RU','ru','en-US','en'] });

  // plugins
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1,2,3,4,5].map(i => ({name: 'Plugin'+i, filename: 'plugin'+i+'.dll'}))
  });

  // permissions
  const originalQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (originalQuery) {
    window.navigator.permissions.query = function(parameters) {
      if (parameters && parameters.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      try {
        return originalQuery.call(this, parameters);
      } catch (e) {
        // Fallback without this-binding in rare cases
        return originalQuery(parameters);
      }
    };
  }

  // hairline (devicePixelRatio quirks)
  Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 + Math.random() * 0.25 });

  // WebGL vendor/renderer
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(param) {
    if (param === 37445) return 'Intel Inc.';        // UNMASKED_VENDOR_WEBGL
    if (param === 37446) return 'Intel Iris OpenGL'; // UNMASKED_RENDERER_WEBGL
    return getParameter.call(this, param);
  };

  // Media devices (avoid empty list)
  const origEnumerate = navigator.mediaDevices && navigator.mediaDevices.enumerateDevices;
  if (origEnumerate) {
    navigator.mediaDevices.enumerateDevices = async () => {
      const list = await origEnumerate.call(navigator.mediaDevices);
      if (!list || list.length === 0) {
        return [
          { kind: 'audioinput', deviceId: 'default', label: 'Default - Microphone' },
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers' },
          { kind: 'videoinput', deviceId: 'default', label: 'Default - Camera' }
        ];
      }
      return list;
    };
  }
})();
`;

// ---------- Executable path detection ----------
async function detectChrome() {
  // If CHROME_PATH is set, use it.
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  // Prefer Puppeteer's bundled Chromium for speed and consistency
  try {
    const p = chromiumExecutablePath();
    if (p) return p;
  } catch {}

  // Fallback to chrome-launcher (finds installed stable Chrome on most OSes).
  try {
    const chrome = await launchChrome({ chromeFlags: ['--headless=new', '--version'] });
    const p = chrome?.chromePath;
    await chrome.kill();
    if (p) return p;
  } catch {}

  // Last resort
  return chromiumExecutablePath();
}

// ---------- Launch ----------
async function main() {
  // Resolve URL from --url or positional, then normalize
  const urlRaw = argv.url ?? (Array.isArray(argv._) && argv._.length > 0 ? String(argv._[0]) : undefined);
  const url = normalizeUrl(urlRaw || 'https://mircli.ru');
  const headless = argv.headless === 'true' ? true : (argv.headless === 'new' ? 'new' : false);
  const proxy = argv.proxy;
  const userDataDir = argv.userdata;

  const execPath = await detectChrome();

  // Common real-world viewport sizes to randomize a bit
  const viewports = [
    { w: 1366, h: 768 }, { w: 1440, h: 900 }, { w: 1536, h: 864 },
    { w: 1920, h: 1080 }, { w: 1600, h: 900 }
  ];
  const vp = viewports[Math.floor(Math.random() * viewports.length)];

  const chromeArgs = [
    `--lang=ru-RU`,
    `--window-size=${vp.w},${vp.h}`,
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-features=NetworkService,NetworkServiceInProcess',
    '--force-webrtc-ip-handling-policy=default_public_interface_only',
    '--disable-dev-shm-usage'
  ];

  if (proxy) chromeArgs.push(`--proxy-server=${proxy}`);

  console.time('launch');
  const browser = await puppeteer.launch({
    headless,
    executablePath: execPath,
    userDataDir,
    args: chromeArgs,
    defaultViewport: null,
    dumpio: true,
    protocolTimeout: argv.timeout,
    ignoreDefaultArgs: [
      // keep as real as possible; don’t strip too much
      '--enable-automation' // puppeteer will add it; stealth handles mitigation
    ]
  });
  console.timeEnd('launch');

  try {
    let [page] = await browser.pages();
    if (!page) page = await browser.newPage();
    if (!page) throw new Error('No page created');

    // Diagnostics
    browser.on('disconnected', () => console.warn('Browser disconnected'));
    page.on('error', err => console.error('Page error:', err));
    page.on('pageerror', err => console.error('Page pageerror:', err));
    page.on('close', () => console.warn('Page closed'));
    page.on('console', msg => {
      try { console.log(`[page:${msg.type()}]`, msg.text()); } catch {}
    });
    page.on('dialog', async dialog => {
      try { await dialog.dismiss(); } catch {}
    });

    // Locale/UA-CH setup through CDP
    const client = await page.target().createCDPSession();
    const uaDesktop = randomUA(); // realistic UA
    await client.send('Network.setUserAgentOverride', {
      userAgent: uaDesktop.ua,
      platform: uaDesktop.platform,
      userAgentMetadata: uaDesktop.uaMeta
    });
    await client.send('Emulation.setLocaleOverride', { locale: 'ru-RU' });
    await client.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Chisinau' });
    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 }); // no throttle

    // Accept-Language header is critical for some checks
    await client.send('Network.enable');
    await client.send('Network.setExtraHTTPHeaders', {
      headers: {
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    // Apply extra patches
    await page.evaluateOnNewDocument(PATCHES);

    // Minimal "human" behavior
    // await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
    // await page.waitForTimeout(250 + Math.random() * 500);

    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
    await new Promise(res => setTimeout(res, 250 + Math.random() * 500));

    // Navigate
    page.setDefaultNavigationTimeout(argv.timeout);
    page.setDefaultTimeout(argv.timeout);

    console.log('Navigating to', url);
    console.time('navigate');
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (e) {
      console.error('Navigation failed for URL:', url, e?.message || e);
      throw e;
    }
    console.timeEnd('navigate');

    // Ensure the DOM exists
    await page.waitForSelector('body', { timeout: Math.min(argv.timeout, 5000) }).catch(() => {});

    // Early snapshot to ensure we always produce output quickly, even if the page later closes
    let earlySaved = false;
    try {
      const earlyHtml = await page.content();
      await fs.writeFile(argv.out, earlyHtml, 'utf8');
      console.log(`Saved early snapshot to ${argv.out} (${Buffer.byteLength(earlyHtml)} bytes)`);
      earlySaved = true;
    } catch (e) {
      console.warn('Early snapshot failed:', e?.message || e);
    }

    // Random scrolls while network is busy (lightweight)
    await randomHumanScroll(page);

    // Wait for network idle-ish + fast DOM quiet period (avoid waiting too long on chatty pages)
    console.time('idle-like');
    const closeRace = new Promise(res => {
      page.once('close', res);
      browser.once('disconnected', res);
    });
    await Promise.race([
      waitForNetworkIdleLike(client, 1000, 4000),
      closeRace
    ]);
    console.timeEnd('idle-like');
    console.time('dom-stable');
    const quietMs = Math.min(Number(argv.wait || 1500), 1500);
    const wallMs = Math.min(Number(argv.timeout || 60000), 3000);
    try {
      await Promise.race([
        waitForDOMStable(page, quietMs, wallMs),
        closeRace
      ]);
    } catch (e) {
      console.warn('dom-stable skipped:', e?.message || e);
    }
    console.timeEnd('dom-stable');

    // If there is a visible “Press & Hold” or Turnstile, bail early with a hint in console (but still dump HTML)
    const challenge = await detectChallenge(page);
    if (challenge) {
      console.warn('Challenge detected:', challenge);
    }

    // Grab fully rendered HTML via DOM (robust with fallback)
    if (page.isClosed()) {
      if (earlySaved) {
        console.warn('Page was closed before final extraction; kept early snapshot.');
      } else {
        throw new Error('Page was closed before extraction and no snapshot was saved');
      }
    } else {
      let html;
      try {
        html = await page.content();
      } catch (e) {
        console.warn('page.content() failed, fallback to evaluate:', e?.message || e);
        if (page.isClosed()) {
          if (earlySaved) {
            console.warn('Page closed during fallback extraction; kept early snapshot.');
            html = null;
          } else {
            throw e;
          }
        } else {
          html = await page.evaluate(() => document.documentElement.outerHTML);
        }
      }
      if (html) {
        await fs.writeFile(argv.out, html, 'utf8');
        console.log(`Saved to ${argv.out} (${Buffer.byteLength(html)} bytes)`);
      }
    }

  } finally {
    // Close browser unless explicitly asked to stay open
    if (!argv.stayopen) {
      await browser.close();
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

// ---------- Helpers ----------

function randomUA() {
  // A small pool of realistic UAs with full UA-CH metadata (Chrome 123+ style).
  const pool = [
    {
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      platform: 'Windows',
      uaMeta: {
        brands: [
          { brand: 'Chromium', version: '126' },
          { brand: 'Not;A=Brand', version: '24' },
          { brand: 'Google Chrome', version: '126' }
        ],
        fullVersionList: [
          { brand: 'Chromium', version: '126.0.6478.55' },
          { brand: 'Not;A=Brand', version: '24.0.0.0' },
          { brand: 'Google Chrome', version: '126.0.6478.55' }
        ],
        platform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false
      }
    },
    {
      ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      platform: 'Linux',
      uaMeta: {
        brands: [
          { brand: 'Chromium', version: '125' },
          { brand: 'Not;A=Brand', version: '24' },
          { brand: 'Google Chrome', version: '125' }
        ],
        fullVersionList: [
          { brand: 'Chromium', version: '125.0.6422.78' },
          { brand: 'Not;A=Brand', version: '24.0.0.0' },
          { brand: 'Google Chrome', version: '125.0.6422.78' }
        ],
        platform: 'Linux',
        platformVersion: '6.0.0',
        architecture: 'x86',
        model: '',
        mobile: false,
        bitness: '64',
        wow64: false
      }
    }
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

async function waitForNetworkIdleLike(client, idleTime = 1500, overallTimeout = 60000) {
  let inflight = 0;
  let fulfill;
  const done = new Promise(res => (fulfill = res));
  let idleTimer;
  const onRequest = (e) => {
    try {
      // Ignore long-lived streams that never finish
      const type = e?.type;
      const url = e?.request?.url || '';
      if (type === 'WebSocket' || type === 'EventSource' || url.startsWith('ws://') || url.startsWith('wss://')) return;
    } catch {}
    inflight++;
    clearTimeout(idleTimer);
  };
  const onFinished = (e) => {
    try {
      const type = e?.type;
      const url = e?.response?.url || '';
      if (type === 'WebSocket' || type === 'EventSource' || url.startsWith('ws://') || url.startsWith('wss://')) return;
    } catch {}
    inflight = Math.max(0, inflight - 1);
    if (inflight === 0) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fulfill(), idleTime);
    }
  };

  const listeners = [
    ['Network.requestWillBeSent', onRequest],
    ['Network.loadingFinished', onFinished],
    ['Network.loadingFailed', onFinished]
  ];
  listeners.forEach(([evt, cb]) => client.on(evt, cb));

  const timeout = setTimeout(() => fulfill(), overallTimeout);
  await done;
  clearTimeout(timeout);
  listeners.forEach(([evt, cb]) => client.off(evt, cb));
}

async function waitForDOMStable(page, settleMs = 3000, maxWallMs = 60000) {
  // Use a MutationObserver-based quiet period detector to avoid heavy DOM serialization
  await page.evaluate(async (quietMs, wallMs) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const start = Date.now();
    let lastMutation = Date.now();
    const observer = new MutationObserver(() => { lastMutation = Date.now(); });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    try {
      while ((Date.now() - lastMutation) < quietMs && (Date.now() - start) < wallMs) {
        await sleep(100);
      }
    } finally {
      observer.disconnect();
    }
  }, settleMs, maxWallMs);
}

function normalizeUrl(input) {
  if (!input || typeof input !== 'string') return 'https://mircli.ru';
  let u = input.trim();
  // Allow passing domain without scheme
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try {
    // Validate
    // eslint-disable-next-line no-new
    new URL(u);
    return u;
  } catch {
    throw new Error(`Invalid URL provided: ${input}`);
  }
}

async function randomHumanScroll(page) {
  const steps = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel({ deltaY: 120 + Math.random() * 280 });
    await new Promise(res => setTimeout(res, 80 + Math.random() * 180));
  }
}

async function detectChallenge(page) {
  // Heuristics for common challenges (Cloudflare Turnstile / IUAM, “press & hold”, etc.)
  const sel = [
    '[id*="challenge"]',
    '[class*="challenge"]',
    'iframe[src*="challenge"]',
    'iframe[src*="turnstile"]',
    '[data-sitekey]',
    'input[name="cf_captcha_kind"]',
    'div:has(> canvas[aria-hidden="true"])'
  ].join(',');
  return (await page.$(sel)) ? 'Possible anti-bot challenge element present' : null;
}
