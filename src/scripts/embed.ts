/*
 * embed.ts — "Play here": the live demo in an <iframe> inside the stage frame
 * (E10). ALWAYS group: boot.ts calls `init()` once at load. No motion here.
 *
 * Markup (ProjectStage.astro), per stage with `embed: true`:
 *   `button[data-embed-open]` (`hidden`) and
 *   `.stage__embed[data-embed][data-embed-src][data-embed-title]` (`hidden`).
 *
 * - init: the button shows (`aria-expanded="false"`).
 * - Click: makes the <iframe> (0 bytes before the click) + a "Close" button in
 *   the container, shows the container (it overlays the poster / video; no
 *   layout shift), pauses the video of the stage, moves focus to the iframe.
 *   Button text -> "Close demo", `aria-expanded="true"`.
 * - Second click, the inner "Close" button, or Esc (focus on one of the two
 *   buttons): removes the iframe and restores the start state.
 * - Open state: `data-embed-active` on the `[data-stage]`. Each change sends a
 *   bubbling `embedchange` event from the stage (video.ts listens).
 * - One embed is open at a time. An embed closes when its stage leaves the viewport.
 */

export type Dispose = () => void;

interface Item {
  stage: HTMLElement;
  button: HTMLButtonElement;
  box: HTMLElement;
  src: string;
  title: string;
  text: Text | null;
  originalText: string;
  open: boolean;
  cleanup: Array<() => void>;
}

const OPEN_TEXT = 'Close demo';

/** Only http(s) pages go into an iframe. */
const safeUrl = (value: string): string => {
  try {
    const url = new URL(value, document.baseURI);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
};

export function init(): Dispose {
  const items: Item[] = [];
  const byStage = new Map<Element, Item>();

  const notify = (item: Item): void => {
    item.stage.dispatchEvent(new CustomEvent<{ open: boolean }>('embedchange', { bubbles: true, detail: { open: item.open } }));
  };

  const close = (item: Item, restoreFocus: boolean): void => {
    if (!item.open) return;
    const active = document.activeElement;
    const focusInside = active instanceof Node && item.box.contains(active);
    item.open = false;
    item.box.replaceChildren();
    item.box.hidden = true;
    item.stage.removeAttribute('data-embed-active');
    item.button.setAttribute('aria-expanded', 'false');
    if (item.text) item.text.data = item.originalText;
    if (restoreFocus || focusInside) item.button.focus({ preventScroll: !restoreFocus });
    notify(item);
  };

  const open = (item: Item): void => {
    if (item.open) return;
    for (const other of items) close(other, false);

    const iframe = document.createElement('iframe');
    iframe.className = 'stage__embed-frame';
    iframe.title = item.title;
    iframe.setAttribute('loading', 'eager');
    iframe.setAttribute('allow', 'fullscreen');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
    iframe.src = item.src;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'stage__embed-close';
    closeButton.append('Close');
    const hint = document.createElement('span');
    hint.className = 'visually-hidden';
    hint.textContent = ` ${item.title}`;
    closeButton.append(hint);
    closeButton.addEventListener('click', () => close(item, true));

    // The close button is first in the DOM: Shift+Tab from the iframe reaches it.
    item.box.replaceChildren(closeButton, iframe);
    item.box.hidden = false;
    item.open = true;
    item.stage.setAttribute('data-embed-active', '');
    item.button.setAttribute('aria-expanded', 'true');
    if (item.text) item.text.data = OPEN_TEXT;
    item.stage.querySelectorAll('video').forEach((video) => video.pause());
    notify(item);
    iframe.focus({ preventScroll: true });
  };

  const listen = (item: Item, target: EventTarget, type: string, handler: EventListener): void => {
    target.addEventListener(type, handler);
    item.cleanup.push(() => target.removeEventListener(type, handler));
  };

  document.querySelectorAll<HTMLElement>('[data-stage]').forEach((stage) => {
    const button = stage.querySelector<HTMLButtonElement>('button[data-embed-open]');
    const box = stage.querySelector<HTMLElement>('[data-embed][data-embed-src]');
    if (!button || !box) return;
    const src = safeUrl(box.getAttribute('data-embed-src') ?? '');
    if (!src) return;

    const text = Array.from(button.childNodes).find((node): node is Text => node instanceof Text && node.data.trim() !== '') ?? null;
    const item: Item = {
      stage,
      button,
      box,
      src,
      title: box.getAttribute('data-embed-title') || 'Live demo',
      text,
      originalText: text ? text.data : '',
      open: false,
      cleanup: [],
    };

    const onKey = (event: Event): void => {
      if (event instanceof KeyboardEvent && event.key === 'Escape' && item.open) {
        event.preventDefault();
        close(item, true);
      }
    };

    listen(item, button, 'click', () => {
      if (item.open) close(item, true);
      else open(item);
    });
    listen(item, button, 'keydown', onKey);
    listen(item, box, 'keydown', onKey);

    button.setAttribute('aria-expanded', 'false');
    button.hidden = false;
    items.push(item);
    byStage.set(stage, item);
  });

  if (items.length === 0) return () => {};

  // A running demo off screen is wasted work: close it.
  let observer: IntersectionObserver | null = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const item = byStage.get(entry.target);
        if (item && !entry.isIntersecting) close(item, false);
      }
    });
    for (const item of items) observer.observe(item.stage);
  }

  return () => {
    observer?.disconnect();
    for (const item of items) {
      close(item, false);
      item.cleanup.forEach((off) => off());
      item.cleanup.length = 0;
      item.button.removeAttribute('aria-expanded');
      item.button.hidden = true;
    }
    items.length = 0;
    byStage.clear();
  };
}
