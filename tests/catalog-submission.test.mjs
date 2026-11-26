import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';
import { discussionLink, newEntry, releaseInput, updateEntry } from '../src/lib/catalog-submission.mjs';

const oldSha = 'a'.repeat(40), nextSha = '1'.repeat(40);
test('tag uses the guide token and public release URLs identify their own app', () => {
  assert.deepEqual(releaseInput('v1.0.0-rc.1','Example-App'), {token:'Example-App',tag:'v1.0.0-rc.1'});
  assert.deepEqual(releaseInput('https://github.com/Other-App/Other-App/releases/tag/v2.0.1','Example-App'), {token:'Other-App',tag:'v2.0.1'});
  for (const input of ['main', 'https://github.com.evil.test/App/App/releases/tag/v1.0.0',
    'https://github.com/App/Another/releases/tag/v1.0.0','https://github.com/App/App/releases/tag/v1.0.0%2Fother']) {
    assert.throws(() => releaseInput(input,'Example-App'));
  }
});
test('new files round-trip titles and string commit hashes with only selected channels', () => {
  const entry = parse(newEntry('Example-App', 'Notes: #1', 'v1.0.0', nextSha, [{target:'ios-uikit',id:'apple-app-store'}]));
  assert.deepEqual(entry, {token:'Example-App',title:'Notes: #1',tag:'v1.0.0',commit:nextSha,distribution:{'ios-uikit':['apple-app-store']}});
});
test('updates preserve comments, line endings, unknown fields and distribution settings', () => {
  const source = ['token: Example-App','title: Example','tag: "v0.9.0" # previous tag',
    "commit: '" + oldSha + "' # reviewed","android-id: org.appfair.example","screenshots: false",
    'distribution:','  ios-uikit:','    - apple-app-store: {submit: false}',''].join('\r\n');
  const result = updateEntry(source,'Example-App','v1.0.0',nextSha);
  assert.deepEqual(result.changes.map(c=>c.field), ['tag','commit']);
  assert.deepEqual(parse(result.yaml), {...parse(source),tag:'v1.0.0',commit:nextSha});
  assert.equal(result.yaml.replace(/tag: .*? #/, 'tag: "v0.9.0" #').replace(/commit: .*? #/, "commit: '" + oldSha + "' #"),source);
  assert.deepEqual(updateEntry(result.yaml,'Example-App','v1.0.0',nextSha).changes, []);
  assert.throws(()=>updateEntry('token: Example-App\ntag: v0.9.0','Example-App','v1.0.0',nextSha));
});
test('first-submission links point to a specific App Fair GitHub discussion', () => {
  assert.equal(discussionLink('https://github.com/orgs/appfair/discussions/42#top'),'https://github.com/orgs/appfair/discussions/42');
  for (const v of ['https://github.com/orgs/other/discussions/42','https://example.org','javascript:foo','']) assert.equal(discussionLink(v),'');
});
