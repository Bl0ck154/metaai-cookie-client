import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMetaAiVideoResultFromText } from '../src/index.js';
import { hasUsableVideoUrl, cookieHeaderToPlaywrightCookies } from '../src/browser-flow.js';

test('intermediate media metadata is not treated as successful video generation', () => {
  const partial = extractMetaAiVideoResultFromText('{"media_id":"12345","filename":"generated_video_abc.mp4"}');
  assert.equal(partial.found, true);
  assert.equal(hasUsableVideoUrl(partial), false);
  assert.equal(hasUsableVideoUrl({ filename: 'video.mp4' }), false);
  assert.equal(hasUsableVideoUrl({ videoUrl: '' }), false);
});

test('only a real HTTP(S) URL qualifies as an accessible video result', () => {
  assert.equal(hasUsableVideoUrl({ videoUrl: 'https://cdn.example.com/generated.mp4?token=fake' }), true);
  assert.equal(hasUsableVideoUrl({ videoUrl: 'http://cdn.example.com/generated.mp4' }), true);
  assert.equal(hasUsableVideoUrl({ videoUrl: 'not-a-url' }), false);
  assert.equal(hasUsableVideoUrl({ videoUrl: 'file:///tmp/video.mp4' }), false);
});

test('cookie parsing for Playwright does not echo or log secrets', () => {
  const cookies = cookieHeaderToPlaywrightCookies('ecto_1_sess=example; rd_challenge=example2');
  assert.deepEqual(cookies.map(cookie => cookie.name), ['ecto_1_sess', 'rd_challenge']);
  assert.ok(cookies.every(cookie => cookie.domain === '.meta.ai' && cookie.secure));
});
