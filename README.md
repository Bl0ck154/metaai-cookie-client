# metaai-cookie-client

Unofficial cookie-based browser client for Meta AI web.

It uses your existing Meta AI web session cookies and drives the website with Playwright. It is not affiliated with Meta and can break when the website changes.

> **Compatibility status (November 2026): experimental / live generation unverified.** The last known source update before this maintenance pass was in July 2026. We have **not** confirmed a successful image-to-video run against the current Meta AI website. A page loading or a media ID appearing is not proof of a generated video. Do not treat this as a reliable production integration until you validate it with your own authorized session.

## What the code attempts (not a current compatibility guarantee)

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

## Manual live test (requires your own active session)

Create `.env`:

```bash
META_AI_COOKIE_HEADER="ecto_1_sess=...; rd_challenge=..."
META_AI_HEADLESS=false
```

Run:

```bash
npm run example:animate -- ./image.png "Animate this image."
```

It writes `output.mp4` **only after video bytes have been returned**; otherwise the command fails instead of reporting a successful generation. An offline unit test cannot validate Meta AI's changing web interface.

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

- `META_AI_COOKIE_HEADER` - full cookie header string from `meta.ai`.
- `META_AI_HEADLESS=false` - show the browser.
- `META_AI_REUSE_BROWSER=false` - launch a fresh browser for every call.
- `META_AI_CHROME_CHANNEL=chrome` - use installed Chrome.
- `META_AI_CHROME_EXECUTABLE_PATH=/path/to/chrome` - use a specific browser.
- `META_AI_TIMEOUT_MS=180000` - generation timeout.
- `META_AI_PROXY_SERVER=http://host:port` - optional browser proxy.
- `META_AI_PROXY_USERNAME` / `META_AI_PROXY_PASSWORD` - optional proxy auth.

## Offline checks

Run `npm run check` and `npm test` to validate JavaScript syntax and basic result handling without logging in or contacting Meta AI. These checks do **not** prove that Meta AI's current interface works. A real compatibility test requires an authorized browser session and must not publish the cookies or generated private content.

## Notes

- This is a browser client, not an official API.
- It needs Playwright and a Chromium-compatible browser.
- By default it reuses one browser process and creates a fresh context per call.
- Direct private WebSocket replay is not implemented.
- Cookies are account secrets.
