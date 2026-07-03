# metaai-cookie-client

Unofficial cookie-based browser client for Meta AI web.

It uses your existing Meta AI web session cookies and drives the website with Playwright. It is not affiliated with Meta and can break when the website changes.

## What is implemented now

- Cookie header parsing.
- Meta AI session check.
- Access token and viewer id extraction from the web app.
- Gateway URL discovery helpers.
- Browser-based prompt submit flow.
- Image-to-video generation through the web UI.

More Meta AI web actions can be added on top of the same cookie/session layer.

## Install

```bash
npm install
npm install playwright
npx playwright install chromium
```

## Cookies

Use a normal cookie header string:

```text
ecto_1_sess=...; rd_challenge=...
```

No `Cookie:` prefix. No JSON.

Do not commit real cookies.

## Quick test

Create `.env`:

```bash
META_AI_COOKIE_HEADER="ecto_1_sess=...; rd_challenge=..."
META_AI_HEADLESS=false
```

Run:

```bash
npm run example:animate -- ./image.png "Animate this image."
```

It writes `output.mp4`.

## Usage

```js
import { generateMetaAiVideo } from './src/index.js';

const result = await generateMetaAiVideo({
  cookieHeader: process.env.META_AI_COOKIE_HEADER,
  prompt: 'Animate this image.',
  referenceImage: {
    base64: '<image base64>',
    mimeType: 'image/png',
  },
});

console.log(result.videoUrl);
console.log(result.mimeType);
```

## Check session

```js
import { getSafeMetaAiStatus } from './src/index.js';

const status = await getSafeMetaAiStatus({
  cookieHeader: process.env.META_AI_COOKIE_HEADER,
});

console.log(status);
```

## Environment

- `META_AI_COOKIE_HEADER` - cookie header string.
- `META_AI_HEADLESS=false` - show the browser.
- `META_AI_CHROME_CHANNEL=chrome` - use installed Chrome.
- `META_AI_CHROME_EXECUTABLE_PATH=/path/to/chrome` - use a specific browser.
- `META_AI_TIMEOUT_MS=180000` - generation timeout.

## Notes

- This is a browser client, not an official API.
- It needs Playwright and a Chromium-compatible browser.
- Direct private WebSocket replay is not implemented.
- Cookies are account secrets.
