import { getCollection } from 'astro:content';
import { newsletterStates } from './newsletter';
import { routeKey } from './localized-links.mjs';

export async function getPageRoutes() {
  const [pages, posts] = await Promise.all([getCollection('pages'), getCollection('blog')]);
  return new Set([
    '/', '/blog', '/newsletter', ...newsletterStates.map(state => `/newsletter/${state}`),
    ...pages.map(page => routeKey('/' + page.id.replace(/(^|\/)index$/, ''))),
    ...posts.filter(post => !post.data.draft || import.meta.env.DEV).map(post => `/blog/${post.id}`),
  ]);
}
