import { defaults } from './submission.mjs';
import { subscribeChecklist } from './submission-state';
import { releaseInput, prepareSubmission, newEntry, discussionLink } from './catalog-submission.mjs';

export function setupCatalogSubmission() {
  const panel = document.querySelector<HTMLElement>('#catalog-submission');
  if (!panel) return;
  const m: Record<string, string> = JSON.parse(panel.dataset.messages!);
  const find = <T extends HTMLElement>(id: string) => panel.querySelector<T>('#catalog-' + id)!;
  const lookup = find<HTMLFormElement>('lookup');
  const release = find<HTMLInputElement>('release');
  const review = find<HTMLFormElement>('review');
  const options = find<HTMLElement>('options');
  const title = find<HTMLInputElement>('title');
  const discussion = find<HTMLInputElement>('discussion');
  const channels = find<HTMLElement>('channels');
  const yaml = find<HTMLTextAreaElement>('yaml');
  const notes = find<HTMLTextAreaElement>('notes');
  const editor = find<HTMLAnchorElement>('editor');
  const status = find<HTMLElement>('status');
  const feedback = find<HTMLElement>('copy-status');
  let guide = { token: defaults.token, title: defaults.title };
  let request: AbortController | undefined;
  let result: Awaited<ReturnType<typeof prepareSubmission>> | undefined;

  function reset() {
    request?.abort();
    result = undefined;
    review.hidden = true;
    status.textContent = '';
    feedback.textContent = '';
    editor.hidden = true;
    lookup.querySelector('button')!.disabled = false;
  }

  function preview() {
    if (!result) return;
    let discussionUrl = '';
    if (result.kind === 'new' && 'channels' in result) {
      discussionUrl = discussionLink(discussion.value);
      discussion.setCustomValidity(discussion.value && !discussionUrl ? m.invalidDiscussion : '');
      const nameLength = [...title.value.trim()].length;
      title.setCustomValidity(nameLength > 0 && nameLength <= 30 ? '' : m.titleLength);
      const checked = Array.from(channels.querySelectorAll<HTMLInputElement>('input:checked'), el => el.value);
      channels.querySelector('input')!.setCustomValidity(checked.length ? '' : m.selectStore);
      yaml.value = newEntry(result.token, title.value.trim(), result.tag, result.commit,
        result.channels.filter(channel => checked.includes(channel.id)));
    }
    const summary = m.propose.replace('{token}', result.token).replace('{tag}', result.tag);
    notes.value = summary + '\n\n' + [result.releaseUrl, discussionUrl].filter(Boolean).join('\n');
    feedback.textContent = '';
  }

  function show() {
    if (!result) return;
    if (result.kind === 'current') {
      status.textContent = m.current.replace('{release}', result.token + ' ' + result.tag);
      return;
    }
    const isNew = result.kind === 'new';
    find('kind').textContent = isNew ? m.newEntry : m.update;
    find('path').textContent = result.path;
    find('handoff').textContent = isNew ? m.createHelp.replace('{path}', result.path) : m.editHelp;
    options.hidden = !isNew;
    title.disabled = discussion.disabled = !isNew;
    channels.replaceChildren();
    const diff = find('diff');
    diff.hidden = isNew;
    if ('channels' in result) {
      title.value = result.title;
      discussion.value = '';
      for (const channel of result.channels) {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = channel.id;
        box.checked = true;
        const names: Record<string, string> = { 'apple-app-store': m.apple, 'google-play-store': m.google };
        label.append(box, names[channel.id] || channel.id);
        channels.append(label);
      }
    } else {
      diff.textContent = result.changes.map(change =>
        '- ' + change.field + ': ' + change.previous + '\n+ ' + change.field + ': ' + change.next).join('\n');
      yaml.value = result.yaml;
    }
    editor.href = result.editor;
    preview();
    review.hidden = false;
    status.textContent = '';
    find('kind').setAttribute('tabindex', '-1');
    find('kind').focus();
  }

  subscribeChecklist(({ values, valid }) => {
    if (!valid || guide.token !== values.token || guide.title !== values.title) reset();
    guide = values;
    find('repo').textContent = m.repo.replace('{repo}', guide.token + '/' + guide.token);
  });
  lookup.addEventListener('submit', async event => {
    event.preventDefault();
    reset();
    const controller = new AbortController();
    request = controller;
    try {
      let input;
      try { input = releaseInput(release.value, guide.token); }
      catch { throw new Error('invalidRelease'); }
      status.textContent = m.loading;
      lookup.querySelector('button')!.disabled = true;
      const prepared = await prepareSubmission(input, guide, controller.signal);
      if (controller.signal.aborted) return;
      result = prepared;
      show();
    } catch (error) {
      if (!controller.signal.aborted) {
        status.textContent = (error instanceof Error && Object.hasOwn(m, error.message) && m[error.message]) || m.lookupFailed;
      }
    } finally {
      if (!controller.signal.aborted) lookup.querySelector('button')!.disabled = false;
    }
  });
  release.addEventListener('input', reset);
  review.addEventListener('input', preview);
  async function copy(field: HTMLTextAreaElement) {
    try {
      await navigator.clipboard.writeText(field.value);
      feedback.textContent = feedback.dataset.copied!;
    } catch {
      field.focus();
      field.select();
      feedback.textContent = feedback.dataset.manual!;
    }
  }
  review.addEventListener('submit', event => {
    event.preventDefault();
    if (!result) return;
    // Open during the user gesture so the editor also works in browsers that block async popups.
    void copy(yaml);
    editor.hidden = false;
    window.open(editor.href, '_blank', 'noopener,noreferrer');
  });
  find('copy-notes').addEventListener('click', () => void copy(notes));
  panel.parentElement!.querySelector<HTMLDetailsElement>('.manual-submission')!.open = false;
  panel.hidden = false;
}
