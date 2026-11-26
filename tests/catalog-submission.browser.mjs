import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SITE_URL || 'http://localhost:4322';
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => { window.copied = value; }}});
    window.open = url => { window.opened = url; return null; };
  });
  // Synthetic public GitHub responses. No editor, repository or real PR is changed.
  const sha = 'a'.repeat(40), previous = 'b'.repeat(40), tagObject = 'c'.repeat(40), policy = 'd'.repeat(40), metadata = 'e'.repeat(40), existing = 'f'.repeat(40);
  const repo = 'Sample-App/Sample-App', tag = 'v1.2.0', url = 'https://github.com/' + repo + '/releases/tag/' + tag;
  let mode = 'new', calls = 0;
  await page.route('https://api.github.com/**', async route => {
    calls++;
    const path = new URL(route.request().url()).pathname;
    assert.equal(route.request().method(),'GET');
    assert.equal(route.request().headers().authorization,undefined);
    assert.equal(route.request().headers().referer,undefined);
    let body;
    if (mode === 'limited') return route.fulfill({status:403,headers:{'x-ratelimit-remaining':'0','access-control-expose-headers':'x-ratelimit-remaining'},body:'{}'});
    if (path.endsWith('/releases/tags/' + tag)) body = {tag_name:tag, html_url:url, draft:false, prerelease:true};
    else if (path.endsWith('/git/ref/tags/' + tag)) body = {object:{type:'tag',sha:tagObject}};
    else if (path.endsWith('/git/tags/' + tagObject)) body = {object:{type:'commit',sha}};
    else if (path.endsWith('/git/trees/main')) body = {tree:[{type:'blob',path:'policy.yaml',sha:policy},
      ...(mode === 'new' ? [] : [{type:'blob',path:'apps/Sample-App.yml',sha:existing}])]};
    else if (path.endsWith('/git/trees/' + sha)) body = {tree:[{type:'blob',path:'store/storefront.toml',sha:metadata}]};
    else if (path.endsWith('/git/blobs/' + policy)) body = 'channels:\n  apple-app-store: {target: ios-uikit, status: ready}\n  google-play-store: {target: android-material, status: ready}\n  future-store: {target: other, status: planned}';
    else if (path.endsWith('/git/blobs/' + metadata)) body = '[storefront.metadata]\nname = "Sample title"';
    else if (path.endsWith('/git/blobs/' + existing)) body = 'token: Sample-App\ntitle: Sample title\ntag: ' +
      (mode === 'current' ? tag : 'v1.0.0') + '\ncommit: ' + (mode === 'current' ? sha : previous) + '\nscreenshots: false # keep\ndistribution: {ios-uikit: [apple-app-store]}\n';
    else return route.fulfill({status:404,body:'{}'});
    await route.fulfill({status:200,contentType:typeof body === 'string'?'text/plain':'application/json',body:typeof body === 'string'?body:JSON.stringify(body)});
  });
  await page.goto(base+'/docs/getting-started/#submit');
  const prepare=page.getByRole('button',{name:'Prepare submission',exact:true});
  const release=page.locator('#catalog-release'), review=page.locator('#catalog-review'), status=page.locator('#catalog-status');
  await prepare.waitFor();
  assert.equal(calls,0);
  await release.fill(url); await prepare.click(); await review.waitFor();
  assert.equal(await page.locator('#catalog-title').inputValue(),'Sample title');
  assert.equal(await page.locator('#catalog-channels input').count(),2);
  await page.getByLabel('Google Play',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Copy YAML and open GitHub'}).click();
  assert.equal(await page.evaluate(()=>window.opened),undefined);
  await page.locator('#catalog-discussion').fill('https://github.com/orgs/appfair/discussions/42');
  await page.getByRole('button',{name:'Copy YAML and open GitHub'}).click();
  assert.deepEqual(parse(await page.evaluate(()=>window.copied)).distribution,{'ios-uikit':['apple-app-store']});
  assert.equal(new URL(await page.evaluate(()=>window.opened)).searchParams.get('filename'),'apps/Sample-App.yaml');
  await page.locator('#catalog-copy-notes').click();
  assert.match(await page.evaluate(()=>window.copied),/discussions\/42/);
  mode='update'; await prepare.click(); await page.locator('#catalog-diff').waitFor();
  assert.match(await page.locator('#catalog-yaml').inputValue(),/screenshots: false # keep/);
  assert.match(await page.locator('#catalog-editor').getAttribute('href'),/edit\/main\/apps\/Sample-App.yml$/);
  assert.equal(await page.locator('#catalog-options').isVisible(),false);
  mode='current'; await prepare.click(); await status.filter({hasText:'already lists'}).waitFor();
  assert.equal(await review.isVisible(),false);
  mode='limited'; await prepare.click(); await status.filter({hasText:'limit'}).waitFor();
  mode='new'; await release.fill('https://example.org/'); await prepare.click();
  await status.filter({hasText:'Enter a release tag'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await release.fill(url); await prepare.click(); await review.waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS: private initial load, public pre-release, annotated tag, create/update/current, store selection, handoff, errors and mobile layout');
} finally { await browser.close(); }
