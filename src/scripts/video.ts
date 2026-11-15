/*
 * video.ts — preview loops in the stage frames (E9). ALWAYS group: boot.ts
 * calls `init()` once at load. The module reads the motion state itself.
 *
 * Markup (ProjectStage.astro): `video[data-loop]` (`hidden`, `preload="none"`,
 * `<source data-src>`) + sibling `button[data-video-toggle]` (`hidden`), both
 * inside `.stage__frame`.
 *
 * Rules:
 * - `navigator.connection.saveData` = true: do nothing. The poster stays.
 * - Else the toggle button shows. Content: an icon (`.stage__video-icon`) +
 *   visually-hidden text "Pause video …" / "Play video …". `aria-pressed`
 *   true = this video plays (or will play when it has loaded).
 * - Load (copy `data-src` -> `src`, `load()`): the frame is near the viewport
 *   (rootMargin 50 %) and playback is expected (motion on and no manual pause,
 *   or a manual play).
 * - Auto play: motion on, frame >= 50 % in view, no manual pause.
 * - Manual play (click): works with motion off too. It ends when the frame
 *   leaves the viewport or motion goes off. A manual pause stays until the
 *   next manual play.
 * - Pause: out of view, `document.hidden`, motion off, embed open in the stage
 *   (`data-embed-active`; embed.ts sends `embedchange`).
 * - One video plays at a time: the last manual play wins, then the most visible.
 * - Error: the video and the button hide. The poster stays.
 */
import { motionOn } from './motion';

export type Dispose = () => void;

interface Item {
  video: HTMLVideoElement;
  toggle: HTMLButtonElement;
  stage: Element | null;
  label: HTMLSpanElement;
  suffix: string;
  original: Node[];
  near: boolean;
  ratio: number;
  loaded: boolean;
  ready: boolean;
  failed: boolean;
  playing: boolean;
  userPaused: boolean;
  /** 0 = no manual play; else the order number of the click. */
  userPlay: number;
  cleanup: Array<() => void>;
}

const saveData = (): boolean => {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return nav.connection?.saveData === true;
};

export function init(): Dispose {
  if (saveData() || !('IntersectionObserver' in window)) return () => {};

  const items: Item[] = [];
  const byFrame = new Map<Element, Item>();
  let stamp = 0;

  const setLabel = (item: Item, playing: boolean): void => {
    item.toggle.setAttribute('aria-pressed', String(playing));
    item.label.textContent = `${playing ? 'Pause video' : 'Play video'}${item.suffix}`;
  };

  const load = (item: Item): void => {
    item.loaded = true;
    item.video.querySelectorAll<HTMLSourceElement>('source[data-src]').forEach((source) => {
      const src = source.getAttribute('data-src');
      if (src) source.setAttribute('src', src);
    });
    item.video.load();
  };

  const sync = (): void => {
    const on = motionOn();
    const pageHidden = document.hidden;
    let best: Item | null = null;

    for (const item of items) {
      if (item.failed) continue;
      const auto = on && !item.userPaused;
      if (!item.loaded && item.near && (auto || item.userPlay > 0)) load(item);
      const embedOpen = item.stage?.hasAttribute('data-embed-active') === true;
      const wanted = !pageHidden && !embedOpen && ((auto && item.ratio >= 0.5) || (item.userPlay > 0 && item.ratio > 0));
      if (!wanted) continue;
      if (!best || item.userPlay > best.userPlay || (item.userPlay === best.userPlay && item.ratio > best.ratio)) best = item;
    }

    for (const item of items) {
      if (item.failed) continue;
      const play = item === best;
      if (play !== item.playing) {
        item.playing = play;
        setLabel(item, play);
      }
      if (play) {
        if (item.ready && item.video.paused) {
          item.video.play().catch((error: unknown) => {
            // The browser blocked playback: show the paused state.
            if (error instanceof DOMException && error.name === 'NotAllowedError') {
              item.userPaused = true;
              item.userPlay = 0;
              sync();
            }
          });
        }
      } else if (!item.video.paused) {
        item.video.pause();
      }
    }
  };

  const fail = (item: Item): void => {
    if (item.failed) return;
    item.failed = true;
    item.playing = false;
    item.video.pause();
    item.video.hidden = true;
    item.toggle.hidden = true;
    sync();
  };

  const listen = (item: Item, target: EventTarget, type: string, handler: EventListener): void => {
    target.addEventListener(type, handler);
    item.cleanup.push(() => target.removeEventListener(type, handler));
  };

  document.querySelectorAll<HTMLVideoElement>('video[data-loop]').forEach((video) => {
    const frame = video.parentElement;
    const toggle = frame?.querySelector<HTMLButtonElement>('button[data-video-toggle]');
    if (!frame || !toggle) return;

    // " of {title}" from the server-rendered label.
    const suffix = toggle.querySelector('.visually-hidden')?.textContent ?? '';
    const icon = document.createElement('span');
    icon.className = 'stage__video-icon';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'visually-hidden';

    const item: Item = {
      video,
      toggle,
      stage: video.closest('[data-stage]'),
      label,
      suffix,
      original: Array.from(toggle.childNodes),
      near: false,
      ratio: 0,
      loaded: false,
      ready: false,
      failed: false,
      playing: false,
      userPaused: false,
      userPlay: 0,
      cleanup: [],
    };

    toggle.replaceChildren(icon, label);
    setLabel(item, false);
    toggle.hidden = false;

    listen(item, toggle, 'click', () => {
      if (item.playing) {
        item.userPaused = true;
        item.userPlay = 0;
      } else {
        for (const other of items) other.userPlay = 0;
        item.userPaused = false;
        stamp += 1;
        item.userPlay = stamp;
      }
      sync();
    });
    listen(item, video, 'canplay', () => {
      if (item.failed) return;
      item.ready = true;
      video.hidden = false; // overlays the poster in the same box
      sync();
    });
    // Before `load()` the sources have no `src`, and the browser sends `error`
    // to them at parse time. Only an error after `load()` is a real failure.
    const onError = (): void => {
      if (item.loaded) fail(item);
    };
    listen(item, video, 'error', onError);
    // When no source can play, the browser sends `error` to the last <source>.
    const sources = video.querySelectorAll('source');
    const lastSource = sources.item(sources.length - 1);
    if (lastSource) listen(item, lastSource, 'error', onError);

    items.push(item);
    byFrame.set(frame, item);
  });

  if (items.length === 0) return () => {};

  // The <video> is `hidden` (no box) at the start, so the observers watch the frame.
  const nearObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const item = byFrame.get(entry.target);
        if (item) item.near = entry.isIntersecting;
      }
      sync();
    },
    { rootMargin: '50%' },
  );
  const viewObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const item = byFrame.get(entry.target);
        if (!item) continue;
        item.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
        if (item.ratio <= 0) item.userPlay = 0;
      }
      sync();
    },
    { threshold: [0, 0.25, 0.5, 0.75, 1] },
  );
  byFrame.forEach((_item, frame) => {
    nearObserver.observe(frame);
    viewObserver.observe(frame);
  });

  const onMotion = (): void => {
    if (!motionOn()) for (const item of items) item.userPlay = 0;
    sync();
  };

  document.addEventListener('motionchange', onMotion);
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('embedchange', sync);

  return () => {
    document.removeEventListener('motionchange', onMotion);
    document.removeEventListener('visibilitychange', sync);
    document.removeEventListener('embedchange', sync);
    nearObserver.disconnect();
    viewObserver.disconnect();
    for (const item of items) {
      item.cleanup.forEach((off) => off());
      item.cleanup.length = 0;
      item.video.pause();
      item.video.hidden = true;
      if (item.loaded) {
        item.video.querySelectorAll('source').forEach((source) => source.removeAttribute('src'));
        item.video.load();
      }
      item.toggle.hidden = true;
      item.toggle.setAttribute('aria-pressed', 'false');
      item.toggle.replaceChildren(...item.original);
    }
    items.length = 0;
    byFrame.clear();
  };
}
