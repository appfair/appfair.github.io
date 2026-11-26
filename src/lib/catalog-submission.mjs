import { isScalar, parse, parseDocument, stringify } from 'yaml';
import { parse as parseToml } from 'smol-toml';

const catalog = 'appfair/appfair-apps';
const api = 'https://api.github.com/repos/';
const tokenPattern = /^[a-z][a-z0-9-]{1,38}$/i;
const tagPattern = /^v\d+\.\d+\.\d+([.-][0-9a-z.-]+)?$/i;
const shaPattern = /^[a-f0-9]{40}$/;

export function releaseInput(input, guideToken) {
  let token = guideToken;
  let tag = input.trim();
  if (tag.startsWith('https://')) {
    const url = new URL(tag);
    const match = /^\/([^/]+)\/([^/]+)\/releases\/tag\/([^/]+)\/?$/.exec(url.pathname);
    if (url.origin !== 'https://github.com' || url.username || url.password || !match ||
        match[1].toLowerCase() !== match[2].toLowerCase()) throw new Error('invalidRelease');
    token = match[1];
    tag = decodeURIComponent(match[3]);
  }
  if (!tokenPattern.test(token) || /--|-$/.test(token) || !tagPattern.test(tag) || !tag.startsWith('v')) {
    throw new Error('invalidRelease');
  }
  return { token, tag };
}

async function read(repo, path, signal, raw = false) {
  const response = await fetch(api + repo + '/' + path, {
    signal, credentials: 'omit', referrerPolicy: 'no-referrer',
    headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' },
  });
  if (response.status === 429 || response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    throw new Error('rateLimit');
  }
  if (!response.ok) throw new Error(response.status === 404 ? 'notFound' : 'lookupFailed');
  return raw ? response.text() : response.json();
}

async function tree(repo, ref, signal) {
  const { tree, truncated } = await read(repo, 'git/trees/' + ref + '?recursive=1', signal);
  if (truncated || !Array.isArray(tree)) throw new Error('lookupFailed');
  return new Map(tree.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry.sha]));
}

function blob(repo, files, path, signal) {
  const sha = files.get(path);
  if (!shaPattern.test(sha)) throw new Error('lookupFailed');
  return read(repo, 'git/blobs/' + sha, signal, true);
}

async function releasedTitle(repo, commit, fallback, signal) {
  const files = await tree(repo, commit, signal);
  const candidates = ['store-appfair', 'store'].flatMap(dir =>
    ['storefront', 'app'].flatMap(name => ['toml', 'yaml', 'yml'].map(ext => dir + '/' + name + '.' + ext)));
  for (const path of [...candidates, 'Day-appfair.toml', 'Day.toml']) {
    if (!files.has(path)) continue;
    const content = await blob(repo, files, path, signal);
    const data = path.endsWith('.toml') ? parseToml(content) : parse(content);
    const title = path.startsWith('Day') ? data?.app?.title : data?.storefront?.metadata?.name;
    if (typeof title === 'string' && title.trim()) return title.trim();
  }
  return fallback;
}

export function updateEntry(source, token, tag, commit) {
  const doc = parseDocument(source);
  if (doc.errors.length || doc.get('token') !== token) throw new Error('catalogError');
  const changes = [];
  for (const [field, next] of Object.entries({ tag, commit })) {
    const node = doc.get(field, true);
    if (!isScalar(node) || !node.range || typeof node.value !== 'string') throw new Error('catalogError');
    if (node.value !== next) changes.push({ field, previous: node.value, next, range: node.range });
  }
  // Replace only the scalar spans. Keep comments, ordering, line endings and all store settings.
  let yaml = source;
  for (const { next, range } of [...changes].sort((a, b) => b.range[0] - a.range[0])) {
    yaml = yaml.slice(0, range[0]) + stringify(next, { compat: 'yaml-1.1' }).trimEnd() + yaml.slice(range[1]);
  }
  return { yaml, changes, title: doc.get('title') };
}

export function newEntry(token, title, tag, commit, channels) {
  const distribution = {};
  for (const { target, id } of channels) (distribution[target] ??= []).push(id);
  return '# yaml-language-server: $schema=../schema/app.schema.json\n' +
    stringify({ token, title, tag, commit, distribution }, { compat: 'yaml-1.1', lineWidth: 0 });
}

export async function prepareSubmission({ token, tag }, guide, signal) {
  const repo = token + '/' + token;
  const release = await read(repo, 'releases/tags/' + encodeURIComponent(tag), signal);
  if (release.draft || release.tag_name !== tag) throw new Error('notFound');
  const canonical = releaseInput(release.html_url, token);
  if (canonical.token.toLowerCase() !== token.toLowerCase() || canonical.tag !== tag) throw new Error('invalidRelease');
  token = canonical.token;
  const ref = await read(repo, 'git/ref/tags/' + encodeURIComponent(tag), signal);
  let object = ref.object;
  const seen = new Set();
  while (object?.type === 'tag' && shaPattern.test(object.sha) && !seen.has(object.sha)) {
    seen.add(object.sha);
    object = (await read(repo, 'git/tags/' + object.sha, signal)).object;
  }
  if (object?.type !== 'commit' || !shaPattern.test(object.sha)) throw new Error('lookupFailed');
  const commit = object.sha;
  const files = await tree(catalog, 'main', signal);
  const prefix = 'apps/' + token.toLowerCase();
  const matches = [...files.keys()].filter(path => [prefix + '.yaml', prefix + '.yml'].includes(path.toLowerCase()));
  if (matches.length > 1) throw new Error('catalogError');
  const path = matches[0] || 'apps/' + token + '.yaml';
  const result = { token, tag, commit, path, releaseUrl: release.html_url };
  if (matches.length) {
    const entryToken = path.slice(5).replace(/\.ya?ml$/, '');
    const source = await blob(catalog, files, path, signal);
    const update = updateEntry(source, entryToken, tag, commit);
    return { ...result, ...update, kind: update.changes.length ? 'update' : 'current',
      editor: 'https://github.com/' + catalog + '/edit/main/' + path };
  }
  const fallback = token.toLowerCase() === guide.token.toLowerCase() ? guide.title : token.replaceAll('-', ' ');
  const [policySource, title] = await Promise.all([
    blob(catalog, files, 'policy.yaml', signal), releasedTitle(repo, commit, fallback, signal),
  ]);
  const policy = parse(policySource);
  const channels = Object.entries(policy.channels).filter(([, channel]) => channel.status === 'ready')
    .map(([id, channel]) => ({ id, target: channel.target }));
  if (!channels.length) throw new Error('catalogError');
  return { ...result, kind: 'new', title, channels,
    editor: 'https://github.com/' + catalog + '/new/main?filename=' + encodeURIComponent(path) };
}

export function discussionLink(value) {
  try {
    const url = new URL(value.trim());
    if (url.origin !== 'https://github.com' || url.username || url.password ||
        !/^\/(?:orgs\/appfair|appfair\/[^/]+)\/discussions\/[1-9]\d*\/?$/i.test(url.pathname)) return '';
    return url.origin + url.pathname;
  } catch { return ''; }
}
