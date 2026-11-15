/*
 * magnetic.ts — magnetic buttons (E8) and media tilt (E4). MOTION group:
 * boot.ts calls `init()` only while motion is on; `dispose()` when it goes off.
 *
 * (a) `[data-magnetic]`: the element moves toward the pointer when the pointer
 *     is within MAGNET_RADIUS px of its box. Max offset MAGNET_MAX px. The offset
 *     uses the individual CSS property `translate` (inline), so it combines
 *     with a `transform` that another script animates. Only the pointer moves
 *     an element; keyboard focus does not.
 * (b) `[data-tilt]` (`.stage__media`): 3D tilt toward the pointer. The tilt is
 *     an inline `transform` on the inner `.stage__frame` (and the same rigid
 *     transform on `.stage__bar`), never on `[data-tilt]` itself. A glare layer
 *     (`.stage__glare`, `aria-hidden`, made here) follows the pointer.
 *     No tilt while the stage has `data-embed-active`.
 *
 * Fine pointers only. One RAF loop; it stops when all values are at rest.
 * Elements off screen are not measured (IntersectionObserver).
 */

export type Dispose = () => void;

const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const MAGNET_RADIUS = 70;
const MAGNET_MAX = 9;
const MAGNET_PULL = 0.3;
const TILT_MAX = 7; // degrees
const TILT_PERSPECTIVE = 1000; // px
/** Time constant of the damping (ms). */
const TAU = 110;
const REST = 0.02;

interface Magnet {
  el: HTMLElement;
  x: number;
  y: number;
  tx: number;
  ty: number;
  applied: boolean;
}

interface Tilt {
  host: HTMLElement;
  frame: HTMLElement;
  bar: HTMLElement | null;
  glare: HTMLElement;
  rx: number;
  ry: number;
  trx: number;
  try: number;
  glow: number;
  tglow: number;
  gx: number;
  gy: number;
  tgx: number;
  tgy: number;
  barOrigin: string;
  applied: boolean;
}

const clamp = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value));

/** Removes an empty `style=""` that inline writes can leave. */
const tidy = (el: HTMLElement): void => {
  if (!el.getAttribute('style')) el.removeAttribute('style');
};

export function init(): Dispose {
  if (typeof window.matchMedia !== 'function' || !window.matchMedia(FINE_POINTER).matches) {
    return () => {};
  }

  const root = document.documentElement;
  const visible = new Set<Element>();
  const hasObserver = 'IntersectionObserver' in window;

  const magnets: Magnet[] = Array.from(document.querySelectorAll<HTMLElement>('[data-magnetic]')).map((el) => ({
    el,
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    applied: false,
  }));

  const tilts: Tilt[] = [];
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((host) => {
    const frame = host.querySelector<HTMLElement>('.stage__frame');
    if (!frame) return;
    const glare = document.createElement('span');
    glare.className = 'stage__glare';
    glare.setAttribute('aria-hidden', 'true');
    // Below the video toggle and the embed (DOM order = paint order).
    frame.insertBefore(glare, frame.querySelector('[data-video-toggle], [data-embed]'));
    tilts.push({
      host,
      frame,
      bar: host.querySelector<HTMLElement>('.stage__bar'),
      glare,
      rx: 0,
      ry: 0,
      trx: 0,
      try: 0,
      glow: 0,
      tglow: 0,
      gx: 0,
      gy: 0,
      tgx: 0,
      tgy: 0,
      barOrigin: '',
      applied: false,
    });
  });

  if (magnets.length === 0 && tilts.length === 0) return () => {};

  let px = 0;
  let py = 0;
  let inside = false;
  let dirty = false;
  let raf = 0;
  let lastTime = 0;

  const isVisible = (el: Element): boolean => !hasObserver || visible.has(el);

  /** Layout reads only. */
  const measure = (): void => {
    for (const m of magnets) {
      m.tx = 0;
      m.ty = 0;
      if (!inside || !isVisible(m.el) || m.el.matches(':disabled, [aria-disabled="true"]')) continue;
      const rect = m.el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // The box without the current offset.
      const dx = px - (rect.left + rect.width / 2 - m.x);
      const dy = py - (rect.top + rect.height / 2 - m.y);
      const gap = Math.hypot(Math.max(Math.abs(dx) - rect.width / 2, 0), Math.max(Math.abs(dy) - rect.height / 2, 0));
      if (gap >= MAGNET_RADIUS) continue;
      const force = (1 - gap / MAGNET_RADIUS) * MAGNET_PULL;
      m.tx = clamp(dx * force, MAGNET_MAX);
      m.ty = clamp(dy * force, MAGNET_MAX);
    }

    for (const t of tilts) {
      t.trx = 0;
      t.try = 0;
      t.tglow = 0;
      if (!inside || !isVisible(t.host)) continue;
      if (t.host.closest('[data-stage]')?.hasAttribute('data-embed-active')) continue;
      const rect = t.host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (px < rect.left || px > rect.right || py < rect.top || py > rect.bottom) continue;
      const nx = (px - rect.left) / rect.width - 0.5; // -0.5 … 0.5
      const ny = (py - rect.top) / rect.height - 0.5;
      t.try = nx * 2 * TILT_MAX;
      t.trx = -ny * 2 * TILT_MAX;
      t.tgx = nx;
      t.tgy = ny;
      t.tglow = 1;
      if (t.bar) {
        // The bar turns around the center of the frame: bar + frame move as one rigid body.
        t.barOrigin = `50% ${(t.bar.offsetHeight + t.frame.offsetHeight / 2).toFixed(1)}px`;
      }
    }
  };

  const clearTilt = (t: Tilt): void => {
    t.frame.style.removeProperty('transform');
    tidy(t.frame);
    if (t.bar) {
      t.bar.style.removeProperty('transform');
      t.bar.style.removeProperty('transform-origin');
      tidy(t.bar);
    }
    t.glare.style.removeProperty('opacity');
    t.glare.style.removeProperty('translate');
    tidy(t.glare);
    t.applied = false;
  };

  const frame = (now: number): void => {
    raf = 0;
    if (dirty) {
      dirty = false;
      measure();
    }
    const dt = lastTime ? Math.min(now - lastTime, 64) : 16;
    lastTime = now;
    const k = 1 - Math.exp(-dt / TAU);
    let active = false;

    for (const m of magnets) {
      m.x += (m.tx - m.x) * k;
      m.y += (m.ty - m.y) * k;
      const atRest = Math.abs(m.tx - m.x) < REST && Math.abs(m.ty - m.y) < REST;
      if (atRest) {
        m.x = m.tx;
        m.y = m.ty;
      } else {
        active = true;
      }
      if (m.x === 0 && m.y === 0) {
        if (m.applied) {
          m.el.style.removeProperty('translate');
          tidy(m.el);
          m.applied = false;
        }
      } else {
        m.el.style.setProperty('translate', `${m.x.toFixed(2)}px ${m.y.toFixed(2)}px`);
        m.applied = true;
      }
    }

    for (const t of tilts) {
      t.rx += (t.trx - t.rx) * k;
      t.ry += (t.try - t.ry) * k;
      t.glow += (t.tglow - t.glow) * k;
      t.gx += (t.tgx - t.gx) * k;
      t.gy += (t.tgy - t.gy) * k;
      const atRest =
        Math.abs(t.trx - t.rx) < REST &&
        Math.abs(t.try - t.ry) < REST &&
        Math.abs(t.tglow - t.glow) < REST &&
        Math.abs(t.tgx - t.gx) < 0.002 &&
        Math.abs(t.tgy - t.gy) < 0.002;
      if (atRest) {
        t.rx = t.trx;
        t.ry = t.try;
        t.glow = t.tglow;
        t.gx = t.tgx;
        t.gy = t.tgy;
      } else {
        active = true;
      }
      if (t.rx === 0 && t.ry === 0 && t.glow === 0) {
        if (t.applied) clearTilt(t);
        continue;
      }
      const transform = `perspective(${TILT_PERSPECTIVE}px) rotateX(${t.rx.toFixed(2)}deg) rotateY(${t.ry.toFixed(2)}deg)`;
      t.frame.style.setProperty('transform', transform);
      if (t.bar) {
        t.bar.style.setProperty('transform-origin', t.barOrigin);
        t.bar.style.setProperty('transform', transform);
      }
      // The glare is 2x the frame: 50 % of its own size = 100 % of the frame.
      t.glare.style.setProperty('translate', `${(t.gx * 50).toFixed(2)}% ${(t.gy * 50).toFixed(2)}%`);
      t.glare.style.setProperty('opacity', t.glow.toFixed(3));
      t.applied = true;
    }

    if (active) raf = requestAnimationFrame(frame);
    else lastTime = 0;
  };

  const schedule = (): void => {
    dirty = true;
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const onMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    px = event.clientX;
    py = event.clientY;
    inside = true;
    schedule();
  };

  const onLeave = (): void => {
    if (!inside) return;
    inside = false;
    schedule();
  };

  const onScroll = (): void => {
    if (inside) schedule();
  };

  let observer: IntersectionObserver | null = null;
  if (hasObserver) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target);
          else visible.delete(entry.target);
        }
        if (inside) schedule();
      },
      { rootMargin: `${MAGNET_RADIUS}px` },
    );
    for (const m of magnets) observer.observe(m.el);
    for (const t of tilts) observer.observe(t.host);
  }

  const passive: AddEventListenerOptions = { passive: true };
  window.addEventListener('pointermove', onMove, passive);
  window.addEventListener('scroll', onScroll, passive);
  window.addEventListener('blur', onLeave);
  root.addEventListener('pointerleave', onLeave);

  return () => {
    window.removeEventListener('pointermove', onMove, passive);
    window.removeEventListener('scroll', onScroll, passive);
    window.removeEventListener('blur', onLeave);
    root.removeEventListener('pointerleave', onLeave);
    observer?.disconnect();
    visible.clear();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const m of magnets) {
      m.el.style.removeProperty('translate');
      tidy(m.el);
    }
    for (const t of tilts) {
      clearTilt(t);
      t.glare.remove();
    }
  };
}
