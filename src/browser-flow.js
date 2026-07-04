import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_USER_AGENT,
  META_AI_HOME,
  META_AI_ORIGIN,
  buildCookieHeader,
  extractMetaAiVideoResultFromText,
  parseCookieHeader,
  safeCookieSummary,
} from './index.js';

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_VIEWPORT = { width: 1280, height: 900 };

let sharedBrowserPromise = null;
let sharedBrowserKey = '';

function metaAiBrowserError(message, { status = 500, code = 'META_AI_BROWSER_ERROR' } = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function wrapStageError(err, stage, { status, code } = {}) {
  if (err?.code?.startsWith?.('META_AI_')) {
    err.stage = err.stage || stage;
    return err;
  }
  const message = String(err?.message || err || '').trim() || 'unknown error';
  const wrapped = metaAiBrowserError(`Meta AI browser flow failed at ${stage}: ${message}`, {
    status: status || err?.status || err?.statusCode || 502,
    code: code || 'META_AI_BROWSER_STAGE_FAILED',
  });
  wrapped.stage = stage;
  wrapped.cause = err;
  return wrapped;
}

function imageExtension(mimeType = '') {
  const clean = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (clean === 'image/png') return '.png';
  if (clean === 'image/webp') return '.webp';
  if (clean === 'image/gif') return '.gif';
  return '.jpg';
}

function normalizeReferenceImage(referenceImage) {
  if (!referenceImage) return null;
  if (typeof referenceImage === 'string') {
    if (/^data:image\//i.test(referenceImage)) {
      const match = referenceImage.match(/^data:([^;]+);base64,(.+)$/i);
      if (!match) return null;
      return { mimeType: match[1], base64: match[2] };
    }
    return { url: referenceImage };
  }
  const mimeType = referenceImage.mimeType || referenceImage.mime_type || 'image/jpeg';
  if (referenceImage.base64) return { mimeType, base64: referenceImage.base64 };
  if (referenceImage.path || referenceImage.filePath) return { path: referenceImage.path || referenceImage.filePath };
  if (referenceImage.url || referenceImage.image_url) return { url: referenceImage.url || referenceImage.image_url };
  return null;
}

async function downloadImageToTemp(imageUrl, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (!/^https?:\/\//i.test(String(imageUrl || ''))) {
    throw metaAiBrowserError('reference image URL must be http(s)', {
      status: 400,
      code: 'META_AI_REFERENCE_IMAGE_URL_INVALID',
    });
  }
  const res = await fetchImpl(imageUrl, {
    signal,
    headers: { 'User-Agent': DEFAULT_USER_AGENT },
  });
  if (!res.ok) {
    throw metaAiBrowserError(`reference image download failed with HTTP ${res.status}`, {
      status: 400,
      code: 'META_AI_REFERENCE_IMAGE_DOWNLOAD_FAILED',
    });
  }
  const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  if (!mimeType.startsWith('image/')) {
    throw metaAiBrowserError(`reference image returned invalid content type: ${mimeType}`, {
      status: 400,
      code: 'META_AI_REFERENCE_IMAGE_TYPE_INVALID',
    });
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const filePath = path.join(os.tmpdir(), `meta-ai-reference-${Date.now()}-${Math.random().toString(16).slice(2)}${imageExtension(mimeType)}`);
  await fs.writeFile(filePath, bytes);
  return { filePath, cleanup: true };
}

async function referenceImageToFile(referenceImage, options = {}) {
  const normalized = normalizeReferenceImage(referenceImage);
  if (!normalized) return null;
  if (normalized.path) return { filePath: normalized.path, cleanup: false };
  if (normalized.url) return downloadImageToTemp(normalized.url, options);
  if (normalized.base64) {
    const filePath = path.join(os.tmpdir(), `meta-ai-reference-${Date.now()}-${Math.random().toString(16).slice(2)}${imageExtension(normalized.mimeType)}`);
    await fs.writeFile(filePath, Buffer.from(String(normalized.base64), 'base64'));
    return { filePath, cleanup: true };
  }
  return null;
}

export function cookieHeaderToPlaywrightCookies(cookieHeader, {
  domain = '.meta.ai',
  url = META_AI_ORIGIN,
} = {}) {
  const parsed = parseCookieHeader(buildCookieHeader(cookieHeader));
  return Object.entries(parsed)
    .filter(([name, value]) => name && value)
    .map(([name, value]) => ({
      name,
      value,
      domain,
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'Lax',
      url: domain ? undefined : url,
    }));
}

function frameToText(data) {
  if (!data) return '';
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof Uint8Array) return Buffer.from(data).toString('utf8');
  return String(data);
}

async function downloadVideo(videoUrl, { fetchImpl = globalThis.fetch, signal } = {}) {
  const res = await fetchImpl(videoUrl, {
    signal,
    headers: {
      'User-Agent': DEFAULT_USER_AGENT,
      Referer: META_AI_HOME,
    },
  });
  if (!res.ok) {
    throw metaAiBrowserError(`Meta AI video download failed with HTTP ${res.status}`, {
      status: res.status,
      code: 'META_AI_VIDEO_DOWNLOAD_FAILED',
    });
  }
  return {
    base64: Buffer.from(await res.arrayBuffer()).toString('base64'),
    mimeType: res.headers.get('content-type')?.split(';')[0]?.trim() || 'video/mp4',
  };
}

function browserLaunchKey(launchOptions) {
  return JSON.stringify({
    headless: launchOptions.headless,
    executablePath: launchOptions.executablePath || '',
    channel: launchOptions.channel || '',
    proxyServer: launchOptions.proxy?.server || '',
    proxyUsername: launchOptions.proxy?.username ? 'set' : '',
  });
}

function proxyOptionsFromEnv() {
  const server = String(process.env.META_AI_PROXY_SERVER || '').trim();
  if (!server) return null;
  const proxy = { server };
  const username = String(process.env.META_AI_PROXY_USERNAME || '').trim();
  const password = String(process.env.META_AI_PROXY_PASSWORD || '').trim();
  if (username) proxy.username = username;
  if (password) proxy.password = password;
  return proxy;
}

function buildLaunchOptions({ headless, executablePath, channel }) {
  const launchOptions = {
    headless: Boolean(headless),
    args: ['--disable-dev-shm-usage'],
  };
  if (executablePath) launchOptions.executablePath = executablePath;
  else if (channel) launchOptions.channel = channel;
  const proxy = proxyOptionsFromEnv();
  if (proxy) launchOptions.proxy = proxy;
  return launchOptions;
}

async function getBrowser(pw, launchOptions, { reuseBrowser = true } = {}) {
  if (!reuseBrowser) {
    return { browser: await pw.chromium.launch(launchOptions), closeAfterUse: true };
  }

  const key = browserLaunchKey(launchOptions);
  if (sharedBrowserPromise && sharedBrowserKey !== key) {
    const oldBrowser = await sharedBrowserPromise.catch(() => null);
    await oldBrowser?.close?.().catch(() => {});
    sharedBrowserPromise = null;
  }

  if (!sharedBrowserPromise) {
    sharedBrowserKey = key;
    sharedBrowserPromise = pw.chromium.launch(launchOptions).catch(err => {
      sharedBrowserPromise = null;
      throw err;
    });
  }

  const browser = await sharedBrowserPromise;
  if (browser.isConnected && !browser.isConnected()) {
    sharedBrowserPromise = null;
    return getBrowser(pw, launchOptions, { reuseBrowser });
  }
  return { browser, closeAfterUse: false };
}

export async function closeMetaAiBrowser() {
  const browser = await sharedBrowserPromise.catch(() => null);
  sharedBrowserPromise = null;
  sharedBrowserKey = '';
  await browser?.close?.().catch(() => {});
}

export async function getMetaAiBrowserStatus({
  cookieHeader,
  headless = process.env.META_AI_HEADLESS !== 'false',
  playwright,
  executablePath = process.env.META_AI_CHROME_EXECUTABLE_PATH || '',
  channel = process.env.META_AI_CHROME_CHANNEL || '',
  reuseBrowser = process.env.META_AI_REUSE_BROWSER !== 'false',
} = {}) {
  const cookies = buildCookieHeader(cookieHeader);
  if (!cookies) {
    throw metaAiBrowserError('Meta AI cookies are not configured', {
      status: 503,
      code: 'META_AI_COOKIES_MISSING',
    });
  }

  const pw = playwright || await import('playwright');
  const launchOptions = buildLaunchOptions({ headless, executablePath, channel });

  let browser;
  let context;
  let closeBrowserAfterUse = true;
  try {
    const browserHandle = await getBrowser(pw, launchOptions, { reuseBrowser });
    browser = browserHandle.browser;
    closeBrowserAfterUse = browserHandle.closeAfterUse;
    context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      userAgent: DEFAULT_USER_AGENT,
      locale: 'ru-RU',
    });
    await context.addCookies(cookieHeaderToPlaywrightCookies(cookies));
    const page = await context.newPage();
    let response;
    try {
      response = await page.goto(META_AI_HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch (err) {
      throw wrapStageError(err, 'browser_status_open_meta_ai');
    }

    const status = response?.status?.() || 0;
    const sourceUrl = page.url();
    if (/login/i.test(sourceUrl)) {
      throw metaAiBrowserError('Meta AI cookies appear to be expired or unauthenticated', {
        status: 401,
        code: 'META_AI_AUTH_EXPIRED',
      });
    }
    if (status >= 400) {
      throw metaAiBrowserError(`Meta AI browser status returned HTTP ${status}`, {
        status,
        code: 'META_AI_BROWSER_STATUS_HTTP',
      });
    }

    return {
      configured: true,
      mode: 'browser',
      sourceUrl,
      sourceStatus: status,
      title: await page.title().catch(() => ''),
      cookieSummary: safeCookieSummary(cookies),
      accessToken: {
        present: false,
        note: 'Browser status loaded Meta AI without extracting a homepage access token.',
      },
      browser: {
        reused: !closeBrowserAfterUse,
        headless: Boolean(headless),
      },
    };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser && closeBrowserAfterUse) await browser.close().catch(() => {});
  }
}

async function clickFirstVisible(locatorCandidates, { timeoutMs = 15_000 } = {}) {
  let lastError = null;
  for (const locator of locatorCandidates) {
    try {
      const count = await locator.count();
      if (!count) continue;
      for (let i = 0; i < count; i += 1) {
        const candidate = locator.nth(i);
        if (await candidate.isVisible().catch(() => false)) {
          await candidate.click({ timeout: timeoutMs });
          return true;
        }
      }
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return false;
}

async function uploadReferenceImage(page, filePath) {
  const fileInput = page.locator('input[type="file"]');
  if (await fileInput.count().catch(() => 0)) {
    await fileInput.first().setInputFiles(filePath);
    return;
  }

  const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
  const clicked = await clickFirstVisible([
    page.getByRole('button', { name: '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u0435', exact: true }),
    page.getByRole('button', { name: 'Add attachment', exact: true }),
    page.getByRole('button', { name: 'Attach file', exact: true }),
    page.getByRole('button', { name: 'Upload file', exact: true }),
    page.locator('[aria-label*="\u0432\u043b\u043e\u0436" i]'),
    page.locator('[aria-label*="attach" i]'),
    page.locator('[aria-label*="upload" i]'),
  ]);
  if (!clicked) {
    throw metaAiBrowserError('Meta AI attachment control was not found', {
      status: 502,
      code: 'META_AI_ATTACHMENT_CONTROL_MISSING',
    });
  }
  const chooser = await chooserPromise;
  await chooser.setFiles(filePath);
}

async function fillPrompt(page, prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    throw metaAiBrowserError('prompt required', {
      status: 400,
      code: 'META_AI_PROMPT_REQUIRED',
    });
  }
  const textboxes = page.getByRole('textbox');
  const count = await textboxes.count();
  if (!count) {
    throw metaAiBrowserError('Meta AI prompt textbox was not found', {
      status: 502,
      code: 'META_AI_PROMPT_BOX_MISSING',
    });
  }
  const box = textboxes.nth(count - 1);
  await box.click({ timeout: 15_000 });
  await page.keyboard.insertText(text);
}

async function clickSend(page) {
  const candidates = [
    page.getByRole('button', { name: '\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c', exact: true }),
    page.getByRole('button', { name: 'Send', exact: true }),
    page.locator('[aria-label="\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c"]'),
    page.locator('[aria-label="Send"]'),
  ];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    for (const locator of candidates) {
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const button = locator.nth(i);
        if (!await button.isVisible().catch(() => false)) continue;
        if (!await button.isEnabled().catch(() => false)) continue;
        await button.click({ timeout: 15_000 });
        return;
      }
    }
    await page.waitForTimeout(500);
  }
  throw metaAiBrowserError('Meta AI send button stayed disabled or was not found', {
    status: 502,
    code: 'META_AI_SEND_BUTTON_UNAVAILABLE',
  });
}

async function waitForVideoResult(page, observedResults, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const direct = observedResults.find(item => item.videoUrl || item.mediaId || item.filename);
    if (direct) return direct;

    const scraped = await page.evaluate(() => {
      const media = [...document.querySelectorAll('video, a')]
        .map(el => el.currentSrc || el.src || el.href || '')
        .find(url => typeof url === 'string' && url.includes('.mp4'));
      return media || '';
    }).catch(() => '');
    if (scraped) return { found: true, videoUrl: scraped };

    await page.waitForTimeout(1500);
  }
  throw metaAiBrowserError(`Meta AI video generation timed out after ${Math.round(timeoutMs / 1000)}s`, {
    status: 504,
    code: 'META_AI_VIDEO_TIMEOUT',
  });
}

export async function generateMetaAiVideoViaBrowser({
  cookieHeader,
  prompt,
  referenceImage,
  imageUrl,
  imagePath,
  headless = process.env.META_AI_HEADLESS !== 'false',
  timeoutMs = Number(process.env.META_AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
  downloadResult = true,
  fetchImpl = globalThis.fetch,
  playwright,
  executablePath = process.env.META_AI_CHROME_EXECUTABLE_PATH || '',
  channel = process.env.META_AI_CHROME_CHANNEL || '',
  reuseBrowser = process.env.META_AI_REUSE_BROWSER !== 'false',
} = {}) {
  const cookies = buildCookieHeader(cookieHeader);
  if (!cookies) {
    throw metaAiBrowserError('Meta AI cookies are not configured', {
      status: 503,
      code: 'META_AI_COOKIES_MISSING',
    });
  }

  const imageFile = imagePath
    ? { filePath: imagePath, cleanup: false }
    : await referenceImageToFile(referenceImage || imageUrl, { fetchImpl });

  const pw = playwright || await import('playwright');
  const launchOptions = buildLaunchOptions({ headless, executablePath, channel });

  let browser;
  let context;
  let closeBrowserAfterUse = true;
  const observedResults = [];
  try {
    const browserHandle = await getBrowser(pw, launchOptions, { reuseBrowser });
    browser = browserHandle.browser;
    closeBrowserAfterUse = browserHandle.closeAfterUse;
    context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      userAgent: DEFAULT_USER_AGENT,
      locale: 'ru-RU',
    });
    await context.addCookies(cookieHeaderToPlaywrightCookies(cookies));
    const page = await context.newPage();

    page.on('response', response => {
      const url = response.url();
      if (/\.mp4(?:\?|$)/i.test(url)) {
        observedResults.push({ found: true, videoUrl: url });
      }
    });
    page.on('websocket', ws => {
      ws.on('framereceived', data => {
        const parsed = extractMetaAiVideoResultFromText(frameToText(data));
        if (parsed.found) observedResults.push(parsed);
      });
    });

    try {
      await page.goto(META_AI_HOME, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    } catch (err) {
      throw wrapStageError(err, 'open_meta_ai');
    }
    if (/login/i.test(page.url())) {
      throw metaAiBrowserError('Meta AI cookies appear to be expired or unauthenticated', {
        status: 401,
        code: 'META_AI_AUTH_EXPIRED',
      });
    }
    try {
      if (imageFile?.filePath) await uploadReferenceImage(page, imageFile.filePath);
    } catch (err) {
      throw wrapStageError(err, 'upload_image');
    }
    try {
      await fillPrompt(page, prompt);
      await clickSend(page);
    } catch (err) {
      throw wrapStageError(err, 'submit_prompt');
    }

    let result;
    try {
      result = await waitForVideoResult(page, observedResults, timeoutMs);
    } catch (err) {
      throw wrapStageError(err, 'wait_video');
    }
    const videoUrl = result.videoUrl || '';
    let downloaded = {};
    if (downloadResult && videoUrl) {
      try {
        downloaded = await downloadVideo(videoUrl, { fetchImpl });
      } catch (err) {
        throw wrapStageError(err, 'download_video');
      }
    }
    return {
      success: true,
      provider: 'meta-ai-browser',
      mode: 'browser',
      videoUrl,
      mediaId: result.mediaId || '',
      filename: result.filename || '',
      width: result.width || 0,
      height: result.height || 0,
      durationMs: result.durationMs || 0,
      ...downloaded,
    };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser && closeBrowserAfterUse) await browser.close().catch(() => {});
    if (imageFile?.cleanup) await fs.unlink(imageFile.filePath).catch(() => {});
  }
}
