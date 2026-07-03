# metaai-cookie-client

Small unofficial cookie-based client for Meta AI web video generation.

It drives the Meta AI website with Playwright. It is not an official Meta product, not affiliated with Meta, and can break any time if the website changes.

## Install

```bash
npm install
npm install playwright
```

If Playwright asks for a browser:

```bash
npx playwright install chromium
```

## Cookies

Pass cookies as one normal cookie header string:

```text
ecto_1_sess=...; rd_challenge=...
```

Do not add `Cookie:` at the beginning.

Do not commit real cookies.

## Quick Test

Create `.env`:

```bash
META_AI_COOKIE_HEADER="ecto_1_sess=...; rd_challenge=..."
META_AI_HEADLESS=false
```

Run:

```bash
npm run example:animate -- ./image.png "Animate this image into a short cute video."
```

The example writes `output.mp4` in this folder.

## Use In Code

```js
import { generateMetaAiVideo } from './src/index.js';

const result = await generateMetaAiVideo({
  cookieHeader: process.env.META_AI_COOKIE_HEADER,
  prompt: 'Animate this image into a short cute video.',
  referenceImage: {
    base64: '<image base64>',
    mimeType: 'image/png',
  },
});

console.log(result.mimeType);
console.log(result.base64.length);
```

## Status Check

```js
import { getSafeMetaAiStatus } from './src/index.js';

const status = await getSafeMetaAiStatus({
  cookieHeader: process.env.META_AI_COOKIE_HEADER,
});

console.log(status.configured);
```

## Options

- `META_AI_COOKIE_HEADER` - cookie header string.
- `META_AI_HEADLESS=false` - show browser while testing.
- `META_AI_CHROME_CHANNEL=chrome` - use installed Chrome.
- `META_AI_CHROME_EXECUTABLE_PATH=/path/to/chrome` - use a specific browser binary.
- `META_AI_TIMEOUT_MS=180000` - generation timeout.

## Notes

- This is brittle by design.
- It drives the website with Playwright.
- Direct private WebSocket replay is not implemented.
- Real cookies are account secrets.
- Use at your own risk.
