import crypto from 'node:crypto';

export const META_AI_ORIGIN = 'https://www.meta.ai';
export const META_AI_HOME = `${META_AI_ORIGIN}/`;
export const META_AI_GATEWAY = 'wss://gateway.meta.ai/ws/clippy';
export const META_AI_APP_ID = '1522763855472543';
export const META_AI_APP_VERSION = '1.0.0';
export const META_AI_DGW_VERSION = '5';
export const META_AI_TIER = 'prod';
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

function isNonEmpty(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function errorWithCode(message, { status = 500, code = 'META_AI_ERROR' } = {}) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

export function parseCookieHeader(cookieHeader = '') {
  const cookies = {};
  for (const part of String(cookieHeader || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

export function buildCookieHeader(input) {
  if (!input) return '';
  if (typeof input === 'string') return input.trim();
  if (typeof input !== 'object') return '';
  return Object.entries(input)
    .filter(([, value]) => isNonEmpty(value))
    .map(([name, value]) => `${name}=${String(value).trim()}`)
    .join('; ');
}

export function safeCookieSummary(cookieHeader) {
  const parsed = parseCookieHeader(cookieHeader);
  return Object.entries(parsed).map(([name, value]) => ({
    name,
    length: String(value || '').length,
  }));
}

export function maskedToken(value) {
  const text = String(value || '');
  if (!text) return '';
  return `${text.slice(0, 10)}...${text.slice(-6)}`;
}

function decodeHtmlJsonEscapes(text) {
  return String(text || '')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export function extractMetaAiAccessToken(html) {
  const source = decodeHtmlJsonEscapes(html);
  const match = source.match(/"accessToken"\s*:\s*"(ecto1:[^"]+)"/)
    || source.match(/\\"accessToken\\"\s*:\s*\\"(ecto1:[^"\\]+)\\"/);
  return match?.[1] || '';
}

export function extractMetaAiViewerId(html) {
  const source = decodeHtmlJsonEscapes(html);
  const match = source.match(/"viewerId"\s*:\s*"(\d+)"/)
    || source.match(/\\"viewerId\\"\s*:\s*\\"(\d+)\\"/);
  return match?.[1] || '';
}

export async function fetchMetaAiHome(cookieHeader, {
  fetchImpl = globalThis.fetch,
  signal,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  if (!cookieHeader) {
    throw errorWithCode('Meta AI cookies are not configured', {
      status: 503,
      code: 'META_AI_COOKIES_MISSING',
    });
  }
  if (typeof fetchImpl !== 'function') {
    throw errorWithCode('fetch implementation is required', {
      status: 500,
      code: 'META_AI_FETCH_MISSING',
    });
  }
  const res = await fetchImpl(META_AI_HOME, {
    signal,
    redirect: 'follow',
    headers: {
      Cookie: cookieHeader,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': userAgent,
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
  });
  const html = await res.text();
  if (!res.ok) {
    throw errorWithCode(`Meta AI homepage returned HTTP ${res.status}`, {
      status: res.status,
      code: 'META_AI_HOME_HTTP',
    });
  }
  return { html, url: res.url, status: res.status };
}

export async function getMetaAiSession({ cookieHeader, fetchImpl, signal } = {}) {
  const cookies = buildCookieHeader(cookieHeader);
  const { html, url, status } = await fetchMetaAiHome(cookies, { fetchImpl, signal });
  const accessToken = extractMetaAiAccessToken(html);
  const viewerId = extractMetaAiViewerId(html);
  if (!accessToken) {
    const isLogin = /login|log in|sign_up/i.test(html) || /login/i.test(url);
    throw errorWithCode(isLogin
      ? 'Meta AI cookies appear to be expired or unauthenticated'
      : 'Meta AI access token was not found in the homepage payload', {
      status: isLogin ? 401 : 502,
      code: isLogin ? 'META_AI_AUTH_EXPIRED' : 'META_AI_ACCESS_TOKEN_MISSING',
    });
  }
  return {
    accessToken,
    viewerId,
    cookieHeader: cookies,
    cookieSummary: safeCookieSummary(cookies),
    sourceUrl: url,
    sourceStatus: status,
  };
}

export function buildMetaAiGatewayUrl({
  accessToken,
  requestId = crypto.randomUUID(),
  uuid = '0',
} = {}) {
  if (!accessToken) throw new Error('accessToken required');
  const params = new URLSearchParams({
    'x-dgw-appid': META_AI_APP_ID,
    'x-dgw-appversion': META_AI_APP_VERSION,
    'x-dgw-authtype': '15:0',
    'x-dgw-version': META_AI_DGW_VERSION,
    'x-dgw-uuid': uuid,
    'x-dgw-tier': META_AI_TIER,
    Authorization: accessToken,
    'x-dgw-app-origin': 'meta.ai',
    'x-dgw-app-clippy-request-id': requestId,
  });
  return `${META_AI_GATEWAY}?${params.toString()}`;
}

export function sanitizeGatewayUrl(gatewayUrl) {
  const url = new URL(gatewayUrl);
  const auth = url.searchParams.get('Authorization') || '';
  if (auth) url.searchParams.set('Authorization', maskedToken(auth));
  return url.toString();
}

export function safeMetaAiStatusFromSession(session) {
  const gatewayUrl = buildMetaAiGatewayUrl({ accessToken: session.accessToken });
  return {
    configured: true,
    viewerId: session.viewerId || '',
    sourceUrl: session.sourceUrl,
    sourceStatus: session.sourceStatus,
    cookieSummary: session.cookieSummary || safeCookieSummary(session.cookieHeader),
    accessToken: {
      present: true,
      length: session.accessToken.length,
      prefix: session.accessToken.slice(0, 6),
    },
    gateway: {
      endpoint: META_AI_GATEWAY,
      sanitizedUrl: sanitizeGatewayUrl(gatewayUrl),
      appId: META_AI_APP_ID,
      appVersion: META_AI_APP_VERSION,
      dgwVersion: META_AI_DGW_VERSION,
    },
  };
}

export async function getSafeMetaAiStatus({ cookieHeader, fetchImpl, signal } = {}) {
  const session = await getMetaAiSession({ cookieHeader, fetchImpl, signal });
  return safeMetaAiStatusFromSession(session);
}

export async function probeMetaAiGateway({
  accessToken,
  WebSocketImpl = globalThis.WebSocket,
  timeoutMs = 10_000,
} = {}) {
  if (!accessToken) throw new Error('accessToken required');
  if (typeof WebSocketImpl !== 'function') {
    throw errorWithCode('WebSocket implementation is required', {
      status: 500,
      code: 'META_AI_WEBSOCKET_MISSING',
    });
  }
  const requestId = crypto.randomUUID();
  const gatewayUrl = buildMetaAiGatewayUrl({ accessToken, requestId });
  const startedAt = Date.now();
  return await new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(gatewayUrl, [], {
      headers: {
        Origin: META_AI_ORIGIN,
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(errorWithCode(`Meta AI gateway probe timed out after ${Math.round(timeoutMs / 1000)}s`, {
        status: 504,
        code: 'META_AI_GATEWAY_TIMEOUT',
      }));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve({
        ok: true,
        requestId,
        durationMs: Date.now() - startedAt,
        gateway: {
          endpoint: META_AI_GATEWAY,
          sanitizedUrl: sanitizeGatewayUrl(gatewayUrl),
        },
      });
    }, { once: true });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(errorWithCode('Meta AI gateway WebSocket probe failed', {
        status: 502,
        code: 'META_AI_GATEWAY_ERROR',
      }));
    }, { once: true });
  });
}

export function decodeGatewayFramePayload(payloadData) {
  if (!payloadData) return '';
  const bytes = typeof payloadData === 'string'
    ? Buffer.from(payloadData, 'base64')
    : Buffer.from(payloadData);
  return bytes.toString('utf8');
}

export function extractMetaAiVideoResultFromText(text) {
  const source = String(text || '');
  const videoUrl = source.match(/https:\/\/scontent\.xx\.fbcdn\.net\/[^"'\\\s]+\.mp4\?[^"'\\\s]+/)?.[0]
    || source.match(/https:\/\/[^"'\\\s]+\.mp4\?[^"'\\\s]+/)?.[0]
    || '';
  const mediaId = source.match(/"media_id"\s*:\s*"([^"]+)"/)?.[1] || '';
  const filename = source.match(/"filename"\s*:\s*"([^"]+\.mp4)"/)?.[1]
    || source.match(/generated_video_[A-Za-z0-9]+\.mp4/)?.[0]
    || '';
  const width = Number(source.match(/"width"\s*:\s*(\d+)/)?.[1] || 0);
  const height = Number(source.match(/"height"\s*:\s*(\d+)/)?.[1] || 0);
  const durationMs = Number(source.match(/"video_duration_ms"\s*:\s*(\d+)/)?.[1]
    || source.match(/"duration"\s*:\s*(\d+)/)?.[1]
    || 0);
  return {
    found: Boolean(videoUrl || mediaId || filename),
    videoUrl,
    mediaId,
    filename,
    width,
    height,
    durationMs,
  };
}

export async function generateMetaAiVideo(options = {}) {
  const { generateMetaAiVideoViaBrowser } = await import('./browser-flow.js');
  return generateMetaAiVideoViaBrowser(options);
}
