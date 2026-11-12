/*
 * anchors.ts — improves hash navigation to the project stages.
 *
 * Group: ALWAYS. The HTML already has the targets: `<section id="{slug}" data-stage>`
 * and, inside it, `<span id="1…5" class="legacy-anchor">`. So `#3` works with no JS.
 *
 * This script only adds:
 * 1. Legacy hash (`#1`…`#5`): scroll to the stage again at `load` and about
 *    1600 ms after `load` (fonts, images, and pinned-scroll spacers move the
 *    target). It stops when the visitor scrolls (wheel, touch, key).
 * 2. Focus: the stage heading (`.stage__title`) gets `tabindex="-1"` and focus
 *    (no scroll), for keyboard and screen-reader users.
 * It never changes the URL. An unknown hash does nothing.
 */

export type Dispose = () => void;

const SETTLE_MS = 1600;
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

interface Target {
  stage: HTMLElement;
  legacy: boolean;
}

function resolve(): Target | null {
  let id = location.hash.slice(1);
  if (!id) return null;
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  const el = document.getElementById(id);
  if (!el) return null;
  if (/^[1-5]$/.test(id)) {
    const stage = el.closest<HTMLElement>('[data-stage]');
    return stage ? { stage, legacy: true } : null;
  }
  return el.matches('[data-stage]') ? { stage: el, legacy: false } : null;
}

export function init(): Dispose {
  const added: HTMLElement[] = [];
  let timer: number | undefined;
  let onLoad: (() => void) | undefined;
  let userScrolled = false;
  let settled = false; // true after the last re-scroll: later jumps need no help

  const stop = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    if (onLoad) window.removeEventListener('load', onLoad);
    onLoad = undefined;
  };

  const focusHeading = (stage: HTMLElement): void => {
    const heading = stage.querySelector<HTMLElement>('.stage__title');
    if (!heading) return;
    if (!heading.hasAttribute('tabindex')) {
      heading.setAttribute('tabindex', '-1');
      added.push(heading);
    }
    heading.focus({ preventScroll: true });
  };

  const settle = (stage: HTMLElement): void => {
    stop();
    if (settled) return;
    userScrolled = false;
    const scroll = (): void => {
      if (!userScrolled && stage.isConnected) stage.scrollIntoView({ block: 'start', behavior: 'auto' });
    };
    const run = (): void => {
      onLoad = undefined;
      scroll();
      timer = window.setTimeout(() => {
        timer = undefined;
        settled = true;
        scroll();
      }, SETTLE_MS);
    };
    if (document.readyState === 'complete') {
      run();
    } else {
      onLoad = run;
      window.addEventListener('load', run, { once: true });
    }
  };

  const handle = (): void => {
    const target = resolve();
    if (!target) {
      stop(); // the visitor went to a different place: do not pull the page back
      return;
    }
    focusHeading(target.stage);
    if (target.legacy) settle(target.stage);
    else stop();
  };

  const onUserScroll = (): void => {
    userScrolled = true;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (SCROLL_KEYS.has(event.key)) userScrolled = true;
  };

  const passive: AddEventListenerOptions = { passive: true };
  window.addEventListener('wheel', onUserScroll, passive);
  window.addEventListener('touchmove', onUserScroll, passive);
  window.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', handle);
  handle();

  return () => {
    stop();
    window.removeEventListener('wheel', onUserScroll);
    window.removeEventListener('touchmove', onUserScroll);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', handle);
    for (const heading of added) heading.removeAttribute('tabindex');
    added.length = 0;
  };
}
