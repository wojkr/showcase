/*
 * tier.ts — device power tier. State: <html data-tier="high" | "low" | "none">.
 *
 *   detectTier()  — sync. The first call probes the device; later calls return
 *                   the cached tier (also after a downgrade by setTier).
 *   setTier(t)    — sets the tier (the scene calls it when it downgrades).
 *   tierLocked()  — true when the URL has `?tier=high|low|none` (QA override).
 *                   The scene then does no automatic downgrade.
 *
 * No `three` import here: this file is part of the main bundle.
 */

export type Tier = 'high' | 'low' | 'none';

/* ---- Tunable limits ---- */
const LOW_MEMORY_GB = 4; // deviceMemory <= this -> low
const LOW_CORES = 4; // hardwareConcurrency <= this -> low
const SMALL_SCREEN_PX = 768; // coarse pointer + shorter screen side below this -> low
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|basic render|software/i;
const UNMASKED_RENDERER_WEBGL = 0x9246;

interface NavigatorHints {
  readonly deviceMemory?: number;
  readonly connection?: { readonly saveData?: boolean };
}

let current: Tier | null = null;
let locked = false;

const isTier = (value: string | null): value is Tier => value === 'high' || value === 'low' || value === 'none';

const readOverride = (): Tier | null => {
  try {
    const value = new URLSearchParams(window.location.search).get('tier');
    return isTier(value) ? value : null;
  } catch {
    return null;
  }
};

const probe = (): Tier => {
  const hints = navigator as Navigator & NavigatorHints;
  if (hints.connection?.saveData === true) return 'none';

  // A temporary canvas: the probe must not fix the context attributes of #scene.
  let renderer = '';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2'); // three 0.180 needs WebGL2
    if (!gl) return 'none';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name: unknown = gl.getParameter(info ? UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    if (typeof name === 'string') renderer = name;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'none';
  }

  if (SOFTWARE_RENDERER.test(renderer)) return 'low';
  if (typeof hints.deviceMemory === 'number' && hints.deviceMemory <= LOW_MEMORY_GB) return 'low';
  if (typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= LOW_CORES) return 'low';
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse && Math.min(window.screen.width, window.screen.height) < SMALL_SCREEN_PX) return 'low';
  return 'high';
};

const apply = (tier: Tier): void => {
  document.documentElement.setAttribute('data-tier', tier);
};

export function detectTier(): Tier {
  if (current === null) {
    const override = readOverride();
    locked = override !== null;
    current = override ?? probe();
  }
  apply(current);
  return current;
}

export function setTier(t: Tier): void {
  current = t;
  apply(t);
}

/** True when `?tier=` forces the tier. The scene then keeps its settings. */
export function tierLocked(): boolean {
  if (current === null) locked = readOverride() !== null;
  return locked;
}
