/*
 * cursor.ts — custom cursor (E8). MOTION group: boot.ts calls `init()` only
 * while motion is on and calls the returned `dispose()` when it goes off.
 *
 * - Fine pointers only (`(hover: hover) and (pointer: fine)`).
 * - Adds two fixed, `aria-hidden` elements to <body>: `.cursor` (dot, follows
 *   the pointer) and `.cursor__ring` (larger, follows with damping).
 * - The native cursor stays visible. The custom cursor is an addition.
 * - States (`data-state` on the two elements; styles in interactions.css):
 *     "link"  — over a link or a control: the ring grows.
 *     "media" — over `.stage__media`: the ring becomes a soft spotlight.
 *   `--cursor-accent` = `--stage-accent` of the closest `[data-stage]` /
 *   `.stage-scope`; without one, CSS uses the brand accent.
 * - Hidden: pointer outside the window, over an <iframe>, while a <dialog> is open.
 * - One RAF loop. It stops when the ring reaches the pointer.
 */

export type Dispose = () => void;

type CursorState = 'default' | 'link' | 'media';

const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const INTERACTIVE = 'a[href], button, summary, label, input, select, textarea, [role="button"]';
const ACCENT_SCOPE = '[data-stage], .stage-scope';
/** Time constant of the ring (ms): smaller = tighter. */
const RING_TAU = 90;
const VISIBLE_CLASS = 'is-visible';

const makePart = (className: string): HTMLDivElement => {
  const part = document.createElement('div');
  part.className = className;
  part.setAttribute('aria-hidden', 'true');
  return part;
};

export function init(): Dispose {
  if (typeof window.matchMedia !== 'function' || !window.matchMedia(FINE_POINTER).matches || !document.body) {
    return () => {};
  }

  const root = document.documentElement;
  const dot = makePart('cursor');
  const ring = makePart('cursor__ring');
  const parts = [ring, dot];
  document.body.append(ring, dot);

  let x = 0;
  let y = 0;
  let ringX = 0;
  let ringY = 0;
  let placed = false;
  let visible = false;
  let raf = 0;
  let checkRaf = 0;
  let lastTime = 0;
  let lastTarget: EventTarget | null = null;
  let state: CursorState = 'default';

  const render = (now: number): void => {
    raf = 0;
    const dt = lastTime ? Math.min(now - lastTime, 64) : 16;
    lastTime = now;
    const k = 1 - Math.exp(-dt / RING_TAU);
    ringX += (x - ringX) * k;
    ringY += (y - ringY) * k;
    const done = Math.abs(x - ringX) < 0.1 && Math.abs(y - ringY) < 0.1;
    if (done) {
      ringX = x;
      ringY = y;
    }
    dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    ring.style.transform = `translate3d(${ringX.toFixed(2)}px, ${ringY.toFixed(2)}px, 0)`;
    if (!done && visible) raf = requestAnimationFrame(render);
    else lastTime = 0;
  };

  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(render);
  };

  const setVisible = (next: boolean): void => {
    if (next === visible) return;
    visible = next;
    parts.forEach((part) => part.classList.toggle(VISIBLE_CLASS, next));
    if (!next && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
      lastTime = 0;
    }
  };

  const hide = (): void => {
    setVisible(false);
    lastTarget = null;
  };

  const setState = (next: CursorState, accent: string): void => {
    if (next !== state) {
      state = next;
      parts.forEach((part) => {
        if (next === 'default') part.removeAttribute('data-state');
        else part.setAttribute('data-state', next);
      });
    }
    parts.forEach((part) => {
      if (accent) part.style.setProperty('--cursor-accent', accent);
      else part.style.removeProperty('--cursor-accent');
    });
  };

  const dialogOpen = (): boolean => document.querySelector('dialog[open]') !== null;

  /** Reads the element below the pointer. Returns false when the cursor must hide. */
  const readTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return true;
    if (target.closest('iframe')) return false;
    const next: CursorState = target.closest(INTERACTIVE) ? 'link' : target.closest('.stage__media') ? 'media' : 'default';
    const scope = next === 'default' ? null : target.closest(ACCENT_SCOPE);
    const accent = scope ? getComputedStyle(scope).getPropertyValue('--stage-accent').trim() : '';
    setState(next, accent);
    return true;
  };

  const onPointer = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    x = event.clientX;
    y = event.clientY;
    if (!placed) {
      placed = true;
      ringX = x;
      ringY = y;
    }
    if (dialogOpen()) {
      hide();
      return;
    }
    if (event.target !== lastTarget) {
      lastTarget = event.target;
      if (!readTarget(event.target)) {
        setVisible(false);
        return;
      }
    } else if (event.target instanceof Element && event.target.closest('iframe')) {
      return;
    }
    if (!visible) {
      // Appear at the pointer, not at the place where the cursor was hidden.
      ringX = x;
      ringY = y;
    }
    setVisible(true);
    schedule();
  };

  /** A click or a key can open a <dialog> while the pointer does not move. */
  const onAction = (): void => {
    if (checkRaf) return;
    checkRaf = requestAnimationFrame(() => {
      checkRaf = 0;
      if (dialogOpen()) hide();
    });
  };

  const passive: AddEventListenerOptions = { passive: true };
  window.addEventListener('pointermove', onPointer, passive);
  window.addEventListener('pointerover', onPointer, passive);
  window.addEventListener('blur', hide);
  root.addEventListener('pointerleave', hide);
  document.addEventListener('click', onAction, true);
  document.addEventListener('keydown', onAction, true);

  return () => {
    window.removeEventListener('pointermove', onPointer, passive);
    window.removeEventListener('pointerover', onPointer, passive);
    window.removeEventListener('blur', hide);
    root.removeEventListener('pointerleave', hide);
    document.removeEventListener('click', onAction, true);
    document.removeEventListener('keydown', onAction, true);
    if (raf) cancelAnimationFrame(raf);
    if (checkRaf) cancelAnimationFrame(checkRaf);
    raf = 0;
    checkRaf = 0;
    dot.remove();
    ring.remove();
  };
}
