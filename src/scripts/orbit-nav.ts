/*
 * orbit-nav.ts — state of the orbit rail (E6). ALWAYS group: boot.ts calls
 * `init()` once at load. It also runs with motion off (state, not animation).
 *
 * - `--progress` (0..1, page scroll fraction) on `.orbit-nav`.
 * - Active project: the `[data-stage]` that covers the vertical center of the
 *   viewport. Its `[data-orbit-link]` (same `#id`) gets `aria-current="true"`;
 *   the others lose it. Hero or pilot in the center: no active link.
 * - One passive scroll listener + resize, throttled with RAF. DOM writes only
 *   when a value changes.
 * - Styles: interactions.css (transitions gated by `html[data-motion='on']`).
 */

export type Dispose = () => void;

export function init(): Dispose {
  const nav = document.querySelector<HTMLElement>('.orbit-nav');
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-orbit-link]'));
  const stages = Array.from(document.querySelectorAll<HTMLElement>('[data-stage]'));
  if (!nav && links.length === 0) return () => {};

  const linkById = new Map<string, HTMLAnchorElement>();
  for (const link of links) {
    const hash = link.getAttribute('href') ?? '';
    if (hash.startsWith('#') && hash.length > 1) linkById.set(decodeURIComponent(hash.slice(1)), link);
  }

  const initialProgress = nav ? nav.style.getPropertyValue('--progress') : '';
  let raf = 0;
  let lastProgress = '';
  let activeId: string | null = null;

  const update = (): void => {
    raf = 0;
    const scroller = document.documentElement;
    const max = scroller.scrollHeight - window.innerHeight;
    const fraction = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
    const progress = fraction.toFixed(4);

    const middle = window.innerHeight / 2;
    let nextId: string | null = null;
    for (const stage of stages) {
      const rect = stage.getBoundingClientRect();
      if (rect.top <= middle && rect.bottom > middle) {
        nextId = stage.id || null;
        break;
      }
    }

    if (nav && progress !== lastProgress) {
      lastProgress = progress;
      nav.style.setProperty('--progress', progress);
    }
    if (nextId !== activeId) {
      activeId = nextId;
      const activeLink = nextId ? linkById.get(nextId) : undefined;
      for (const link of links) {
        if (link === activeLink) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    }
  };

  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(update);
  };

  const passive: AddEventListenerOptions = { passive: true };
  window.addEventListener('scroll', schedule, passive);
  window.addEventListener('resize', schedule, passive);
  window.addEventListener('load', schedule);
  update();

  return () => {
    window.removeEventListener('scroll', schedule, passive);
    window.removeEventListener('resize', schedule, passive);
    window.removeEventListener('load', schedule);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const link of links) link.removeAttribute('aria-current');
    if (nav) {
      if (initialProgress) nav.style.setProperty('--progress', initialProgress);
      else nav.style.removeProperty('--progress');
    }
  };
}
