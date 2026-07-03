import fs from 'node:fs/promises';
import path from 'node:path';

import { generateMetaAiVideo } from '../src/index.js';

const [, , imagePath, ...promptParts] = process.argv;
const prompt = promptParts.join(' ').trim() || 'Animate this image into a short video.';

function usage() {
  console.error('Usage: npm run example:animate -- ./image.png "Animate this image"');
  process.exit(1);
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

if (!imagePath) usage();

const cookieHeader = process.env.META_AI_COOKIE_HEADER || process.env.META_AI_COOKIES || '';
if (!cookieHeader.trim()) {
  console.error('META_AI_COOKIE_HEADER is required.');
  process.exit(1);
}

const image = await fs.readFile(imagePath);
const result = await generateMetaAiVideo({
  cookieHeader,
  prompt,
  referenceImage: {
    base64: image.toString('base64'),
    mimeType: mimeTypeForFile(imagePath),
  },
});

if (!result.base64) {
  console.error('No base64 video returned.');
  if (result.videoUrl) console.error(`Video URL: ${result.videoUrl}`);
  process.exit(1);
}

const outputPath = path.resolve('output.mp4');
await fs.writeFile(outputPath, Buffer.from(result.base64, 'base64'));
console.log(`Saved ${outputPath}`);
