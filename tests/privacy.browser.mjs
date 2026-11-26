import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engines = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL(process.env.SITE_URL || 'http://127.0.0.1:4323');
const files = await readdir(new URL('../dist/', import.meta.url), { recursive: true });
const pages = files.filter(file => file.endsWith('.html'));
assert.ok(pages.includes('index.html'), 'Build the site before running the privacy check');

const browser = await engines[process.env.BROWSER || 'chromium'].launch({ headless: true });
try {
  const context = await browser.newContext();
  const external = new Set();
  // Record attempted third-party requests without sending any traffic to their destinations.
  await context.route(/^https?:/, route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === base.origin) return route.continue();
    external.add(`${request.frame().url()} requested ${url.href}`);
    return route.abort();
  });
  const visitPages = async files => {
    const page = await context.newPage();
    for (const file of files) {
      const path = '/' + file.replace(/(^|\/)index\.html$/, '$1');
      const response = await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' });
      assert.ok(response.ok() || file.endsWith('404.html') && response.status() === 404, file);
      const hints = await page.locator('a[ping], link[rel~=preconnect], link[rel~=dns-prefetch]').evaluateAll(nodes =>
        nodes.flatMap(node => node.tagName === 'A' ? node.ping.split(/\s+/) : [node.href])
          .filter(url => new URL(url, document.baseURI).origin !== location.origin));
      assert.deepEqual(hints, [], file);
    }
    await page.close();
  };
  const batchSize = Math.ceil(pages.length / 4);
  const batches = [];
  for (let i = 0; i < pages.length; i += batchSize) batches.push(visitPages(pages.slice(i, i + batchSize)));
  await Promise.all(batches);

  const page = await context.newPage();
  await page.goto(base.href);
  const results = await page.evaluate(async () => {
    const search = await import('/pagefind/pagefind.js');
    return (await search.search('App Fair')).results.length;
  });
  assert.ok(results > 0, 'Search must work using the local index');
  assert.deepEqual([...external], []);
  console.log(`PASS: ${pages.length} production pages and a search made no third-party requests`);
} finally {
  await browser.close();
}
