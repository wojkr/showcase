/*
 * boot.ts — the one script entry of the page (BaseLayout imports it).
 *
 * 1. Wires each `[data-motion-toggle]` button (click -> setMotion; `aria-pressed` follows).
 * 2. ALWAYS modules: init once (wake, anchors, orbit-nav, video, embed).
 * 3. MOTION modules: lazy-load and init when motion is on; dispose when it goes off.
 *    Order: light effects first (kinetic, scroll, cursor, magnetic, game), then the
 *    WebGL scene after the page load, when the browser is idle.
 *
 * `<html data-fx="ready">` is set while the MOTION effects run. CSS start states
 * that hide content need it, so a failed script load never hides content.
 */
import { motionOn, onMotionChange, setMotion } from './motion.ts';
import { detectTier } from './tier.ts';
import { init as initWake } from './wake.ts';
import { init as initAnchors } from './anchors.ts';
import { init as initOrbitNav } from './orbit-nav.ts';
import { init as initVideo } from './video.ts';
import { init as initEmbed } from './embed.ts';

type Dispose = () => void;

const root = document.documentElement;

/* ---------- 1. Motion toggle ---------- */

const toggles = document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]');

const syncToggles = (on: boolean): void => {
  toggles.forEach((toggle) => toggle.setAttribute('aria-pressed', String(on)));
};

toggles.forEach((toggle) => {
  toggle.hidden = false;
  toggle.addEventListener('click', () => setMotion(!motionOn()));
});
syncToggles(motionOn());

/* ---------- 2. ALWAYS modules ---------- */

const safe = (fn: () => Dispose | void): Dispose => {
  try {
    return fn() ?? (() => {});
  } catch {
    return () => {};
  }
};

[initWake, initAnchors, initOrbitNav, initVideo, initEmbed].forEach((init) => safe(init));

/* ---------- 3. MOTION modules ---------- */

let disposers: Dispose[] = [];
/** Changes on each on/off switch. A late dynamic import checks it and stops. */
let generation = 0;

const whenLoadedAndIdle = (cb: () => void): void => {
  const idle = (): void => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(cb, { timeout: 1500 });
    } else {
      window.setTimeout(cb, 200);
    }
  };
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
};

const startMotion = async (): Promise<void> => {
  const mine = ++generation;
  const alive = (): boolean => mine === generation && motionOn();

  try {
    const [kinetic, scroll, cursor, magnetic] = await Promise.all([
      import('./kinetic.ts'),
      import('./scroll.ts'),
      import('./cursor.ts'),
      import('./magnetic.ts'),
    ]);
    if (!alive()) return;
    root.setAttribute('data-fx', 'ready');
    disposers.push(safe(kinetic.init), safe(scroll.init), safe(cursor.init), safe(magnetic.init));
  } catch {
    root.removeAttribute('data-fx');
  }

  whenLoadedAndIdle(() => {
    if (!alive()) return;

    import('./game.ts')
      .then((game) => {
        if (alive()) disposers.push(safe(game.init));
      })
      .catch(() => {});

    const tier = detectTier();
    if (tier === 'none') return;
    import('./scene/index.ts')
      .then((scene) => {
        if (alive()) disposers.push(safe(() => scene.init(tier)));
      })
      .catch(() => {});
  });
};

const stopMotion = (): void => {
  generation++;
  // Reverse order: the scene and the game stop first, the scroll effects last.
  disposers.reverse().forEach((dispose) => safe(dispose));
  disposers = [];
  root.removeAttribute('data-fx');
};

onMotionChange((on) => {
  syncToggles(on);
  if (on) void startMotion();
  else stopMotion();
});

if (motionOn()) void startMotion();
