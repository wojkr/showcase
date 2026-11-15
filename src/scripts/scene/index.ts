/*
 * scene/index.ts — the ORBIT WebGL scene (effects E1, E2, E7).
 *
 *   init(tier)  — starts the scene on <canvas id="scene">. Returns dispose().
 *                 Fail-safe: on any error it cleans up, calls setTier('none'),
 *                 and returns a no-op.
 *   dispose()   — stops the loop, removes listeners, frees GPU objects, clears
 *                 the canvas, removes `data-scene`. A later init() works again.
 *
 * Camera: native scroll only. Each frame (when scroll or layout changed) the
 * code reads the rects of the hero, each [data-stage], and #pilot, and maps the
 * viewport center to a progress value: 0 = hero, 1..n = planets, n+1 = pilot.
 * Tunable constants: ./config.ts. World objects: ./world.ts.
 */
import { Color, Euler, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3, WebGLRenderer } from 'three';
import { setTier, tierLocked } from '../tier';
import * as C from './config';
import { createWorld } from './world';
import type { PlanetSpec, World } from './world';

export type Dispose = () => void;

interface SceneStats {
  fps: number;
  frames: number;
  tier: string;
}

declare global {
  interface Window {
    /** QA only. Updated about once per second while the scene runs. */
    __sceneStats?: SceneStats;
  }
}

const enum Kind {
  Hero,
  Planet,
  Pilot,
}

interface Station {
  readonly el: Element | null;
  readonly kind: Kind;
  /** Index into world.planets (Kind.Planet only). */
  readonly planet: number;
  /** +1 = planet on the right, -1 = left. */
  readonly side: number;
  readonly pos: Vector3;
  readonly quat: Quaternion;
}

const noop: Dispose = () => {};
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth01 = (x: number): number => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const ramp = (a: number, b: number, x: number): number => smooth01((x - a) / (b - a));
const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

const readSpec = (stage: HTMLElement, index: number): PlanetSpec => {
  let radius = 1.2;
  let seed = index * 17 + 3;
  let rings = false;
  let hue = 280;
  try {
    const data: unknown = JSON.parse(stage.dataset.planet ?? '{}');
    if (typeof data === 'object' && data !== null) {
      const d = data as Record<string, unknown>;
      if (typeof d.radius === 'number' && Number.isFinite(d.radius) && d.radius > 0) radius = d.radius;
      if (typeof d.seed === 'number' && Number.isFinite(d.seed)) seed = d.seed;
      if (typeof d.hue === 'number' && Number.isFinite(d.hue)) hue = d.hue;
      rings = d.rings === true;
    }
  } catch {
    // Bad JSON: keep the defaults.
  }
  const accent = getComputedStyle(stage).getPropertyValue('--stage-accent').trim();
  return { radius: MathUtils.clamp(radius, 0.4, 3), seed, rings, hue, accent: accent === '' ? null : accent };
};

export function init(tier: 'high' | 'low'): Dispose {
  const canvas = document.getElementById('scene');
  if (!(canvas instanceof HTMLCanvasElement)) {
    setTier('none');
    return noop;
  }
  let gl: WebGL2RenderingContext | null = null;
  try {
    // The first call fixes the attributes of the canvas context. Later calls return the same context.
    gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: tier === 'high',
      depth: true,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
  } catch {
    gl = null;
  }
  if (gl === null || gl.isContextLost()) {
    setTier('none');
    return noop;
  }
  try {
    return start(canvas, gl, tier);
  } catch {
    delete document.documentElement.dataset.scene;
    setTier('none');
    return noop;
  }
}

function start(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, tier: 'high' | 'low'): Dispose {
  const root = document.documentElement;
  const locked = tierLocked();
  let mode: 'high' | 'low' = tier;
  let dprCap = tier === 'high' ? C.DPR_HIGH : C.DPR_LOW;

  /* ---- DOM (read once; rects are read each frame) ---- */
  const heroEl = document.querySelector('[data-section="hero"]');
  const pilotEl = document.querySelector('[data-section="pilot"]');
  const stageEls = Array.from(document.querySelectorAll<HTMLElement>('[data-stage]'));
  const specs = stageEls.map(readSpec);

  /* ---- Renderer + world ---- */
  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: tier === 'high', alpha: true });
  let world: World;
  try {
    renderer.setClearColor(new Color(C.CLEAR_COLOR), 1);
    world = createWorld(renderer, tier, specs);
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  const uniforms = world.uniforms;
  const camera = new PerspectiveCamera(C.FOV_DEG, 1, C.CAM_NEAR, C.CAM_FAR);

  /* ---- Stations ---- */
  const stations: Station[] = [];
  const addStation = (el: Element | null, kind: Kind, planet: number, side: number): void => {
    stations.push({ el, kind, planet, side, pos: new Vector3(), quat: new Quaternion() });
  };
  if (heroEl !== null) addStation(heroEl, Kind.Hero, -1, 1);
  stageEls.forEach((el, index) => addStation(el, Kind.Planet, index, el.dataset.side === 'left' ? -1 : 1));
  if (pilotEl !== null) addStation(pilotEl, Kind.Pilot, -1, 1);
  if (stations.length === 0) addStation(null, Kind.Hero, -1, 1);
  const count = stations.length;
  const station = (i: number): Station => stations[i < 0 ? 0 : i >= count ? count - 1 : i] as Station;
  const spanStart = new Float32Array(count);
  const spanEnd = new Float32Array(count);

  /* ---- Scratch objects (no allocation in the loop) ---- */
  const ZERO = new Vector3(0, 0, 0);
  const UP = new Vector3(0, 1, 0);
  const m4 = new Matrix4();
  const v1 = new Vector3();
  const v2 = new Vector3();
  const v3 = new Vector3();
  const tan1 = new Vector3();
  const tan2 = new Vector3();
  const rigPos = new Vector3();
  const prevRigPos = new Vector3();
  const rigQuat = new Quaternion();
  const offsetQuat = new Quaternion();
  const euler = new Euler();

  /** Puts the station camera so that `target` shows at NDC (nx, ny) at view depth `depth`. */
  const place = (st: Station, target: Vector3, depth: number, nx: number, ny: number, forward: Vector3, aspect: number): void => {
    const t = Math.tan(MathUtils.degToRad(C.FOV_DEG) / 2);
    m4.lookAt(ZERO, forward, UP);
    st.quat.setFromRotationMatrix(m4);
    v3.set(nx * t * aspect * depth, ny * t * depth, -depth).applyQuaternion(st.quat);
    st.pos.copy(target).sub(v3);
  };

  /** Unit view direction: `angle` away from the sun direction at orbit angle `theta`, plus a pitch. */
  const viewDir = (theta: number, angle: number, pitch: number, out: Vector3): Vector3 => {
    const cs = Math.cos(angle);
    const sn = Math.sin(angle);
    // Sun direction (-cos, 0, -sin) and orbit tangent (-sin, 0, cos).
    out.set(-Math.cos(theta) * cs - Math.sin(theta) * sn, pitch, -Math.sin(theta) * cs + Math.cos(theta) * sn);
    return out.normalize();
  };

  const layoutStations = (aspect: number, narrow: boolean): void => {
    const t = Math.tan(MathUtils.degToRad(C.FOV_DEG) / 2);
    const first = world.planets[0];
    const last = world.planets[world.planets.length - 1];
    for (const st of stations) {
      if (st.kind === Kind.Hero) {
        const rho = narrow ? C.HERO_SUN_SCREEN_RADIUS_NARROW : C.HERO_SUN_SCREEN_RADIUS;
        const nx = narrow ? C.HERO_SUN_NDC_NARROW[0] : C.HERO_SUN_EDGE_X + rho / aspect;
        const ny = narrow ? C.HERO_SUN_NDC_NARROW[1] : C.HERO_SUN_TOP_Y - rho;
        viewDir(first ? first.theta : C.ORBIT_ANGLE_START, C.HERO_VIEW_ANGLE, C.HERO_PITCH, v1);
        place(st, ZERO, C.SUN_RADIUS / (rho * t), nx, ny, v1, aspect);
      } else if (st.kind === Kind.Planet) {
        const planet = world.planets[st.planet];
        if (!planet) continue;
        const scale = MathUtils.clamp(planet.radius / C.PLANET_REF_RADIUS, C.PLANET_SIZE_MIN, C.PLANET_SIZE_MAX);
        const rho = (narrow ? C.PLANET_SCREEN_RADIUS_NARROW : C.PLANET_SCREEN_RADIUS) * scale;
        const nx = narrow ? C.PLANET_NDC_NARROW[0] : st.side * C.PLANET_NDC_X;
        const ny = narrow ? C.PLANET_NDC_NARROW[1] : C.PLANET_NDC_Y;
        viewDir(planet.theta, C.PLANET_SUN_ANGLE, C.PLANET_PITCH, v1);
        place(st, planet.position, planet.radius / (rho * t), nx, ny, v1, aspect);
        // Key light: fixed in the camera space of the station, from the media side.
        planet.lightDir
          .set(st.side * C.PLANET_KEY_LIGHT[0], C.PLANET_KEY_LIGHT[1], C.PLANET_KEY_LIGHT[2])
          .normalize()
          .applyQuaternion(st.quat);
      } else {
        const phi = (last ? last.theta : C.ORBIT_ANGLE_START) + C.PILOT_AZIMUTH_OFFSET;
        const ce = Math.cos(C.PILOT_ELEVATION);
        v1.set(-Math.cos(phi) * ce, -Math.sin(C.PILOT_ELEVATION), -Math.sin(phi) * ce);
        const depth = C.PILOT_DISTANCE * Math.max(1, C.PILOT_FIT_ASPECT / aspect);
        place(st, ZERO, depth, C.PILOT_NDC[0], C.PILOT_NDC[1], v1, aspect);
      }
    }
  };

  /** Camera position on the path: Hermite curve from station i to i + 1, with limited tangents. */
  const evalPath = (i: number, t: number, out: Vector3): void => {
    const p0 = station(i - 1).pos;
    const p1 = station(i).pos;
    const p2 = station(i + 1).pos;
    const p3 = station(i + 2).pos;
    const length = p1.distanceTo(p2);
    tan1.subVectors(p2, p0).multiplyScalar(0.5 * C.PATH_TENSION);
    tan2.subVectors(p3, p1).multiplyScalar(0.5 * C.PATH_TENSION);
    if (tan1.lengthSq() > length * length) tan1.setLength(length);
    if (tan2.lengthSq() > length * length) tan2.setLength(length);
    const t2 = t * t;
    const t3 = t2 * t;
    out
      .copy(p1)
      .multiplyScalar(2 * t3 - 3 * t2 + 1)
      .addScaledVector(tan1, t3 - 2 * t2 + t)
      .addScaledVector(p2, -2 * t3 + 3 * t2)
      .addScaledVector(tan2, t3 - t2);
  };

  /* ---- State ---- */
  let narrowLayout = false;
  /** Side of the text at a station: -1 left, +1 right, 0 none (pilot, one-column layout). */
  const textSide = (st: Station): number =>
    narrowLayout || st.kind === Kind.Pilot ? 0 : st.kind === Kind.Hero ? -1 : -st.side;
  let running = false;
  let disposed = false;
  let raf = 0;
  let resizeTimer = 0;
  let last = 0;
  let frames = 0;
  let firstFrame = true;
  let dirty = true;
  let progressTarget = 0;
  let progress = 0;
  let lastScrollY = window.scrollY;
  let scrollSpeed = 0; // smoothed, viewport heights per second
  let warp = 0;
  let fov = C.FOV_DEG;
  // Pointer: target, slow value (camera parallax), fast value (glow / repulsion).
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let pointerX = 0;
  let pointerY = 0;
  let pointerActive = 0;
  let parallaxX = 0;
  let parallaxY = 0;
  // FPS windows.
  let statFrames = 0;
  let statTime = 0;
  let windows = 0;
  let slowWindows = 0;
  const stats: SceneStats = { fps: 0, frames: 0, tier: mode };
  window.__sceneStats = stats;

  /** Reads the section rects and sets `progressTarget`. */
  const measure = (): void => {
    dirty = false;
    if (station(0).el === null) {
      progressTarget = 0;
      return;
    }
    const vh = window.innerHeight;
    for (let i = 0; i < count; i++) {
      const el = station(i).el;
      if (el === null) continue;
      const rect = el.getBoundingClientRect();
      const margin = Math.min(rect.height, vh) / 2;
      // Signed distance from the viewport center to the hold zone of the section.
      spanStart[i] = rect.top + margin - vh / 2;
      spanEnd[i] = rect.bottom - margin - vh / 2;
    }
    let p = count - 1;
    for (let i = 0; i < count; i++) {
      const a = spanStart[i] ?? 0;
      const b = spanEnd[i] ?? 0;
      if (a >= 0 || b >= 0) {
        // The viewport center is before or inside section i.
        p = i;
        if (a > 0 && i > 0) {
          const prevEnd = spanEnd[i - 1] ?? 0;
          const gap = a - prevEnd;
          p = gap > 0 ? i - 1 + clamp01(-prevEnd / gap) : i;
        }
        break;
      }
    }
    progressTarget = p;
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, dprCap);
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false); // false: never touch the canvas style (no layout change)
    const aspect = width / height;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const narrow = window.innerWidth < C.NARROW_BREAKPOINT_PX;
    narrowLayout = narrow;
    uniforms.uAspect.value = aspect;
    uniforms.uPx.value = ratio * MathUtils.clamp(height / 900, 0.85, 1.5);
    uniforms.uDim.value = narrow ? C.PLANET_DIM_NARROW : 1;
    renderer.getDrawingBufferSize(uniforms.uRes.value);
    layoutStations(aspect, narrow);
    dirty = true;
  };

  const downgrade = (): void => {
    mode = 'low';
    dprCap = C.DPR_LOW;
    world.setLow();
    uniforms.uWarp.value = 0;
    warp = 0;
    resize();
    setTier('low');
    stats.tier = mode;
    slowWindows = 0;
    windows = C.FPS_WARMUP_WINDOWS - 1; // one window of grace after the switch
  };

  const frame = (now: number): void => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const rawDt = (now - last) / 1000;
    last = now;
    const counted = rawDt > 0 && rawDt < 0.25; // a long gap (tab switch, hitch) is not a measurement
    const dt = rawDt < 0 ? 0 : rawDt > 0.1 ? 0.1 : rawDt;

    /* Scroll -> progress */
    const scrollY = window.scrollY;
    if (scrollY !== lastScrollY) dirty = true;
    const speed = dt > 0 ? Math.abs(scrollY - lastScrollY) / dt / Math.max(1, window.innerHeight) : 0;
    lastScrollY = scrollY;
    scrollSpeed += (speed - scrollSpeed) * damp(10, dt);
    frames++;
    if (dirty || frames % 30 === 0) measure();

    const before = progress;
    if (firstFrame) progress = progressTarget;
    else progress += (progressTarget - progress) * damp(C.CAM_DAMPING, dt);
    const travel = dt > 0 ? Math.abs(progress - before) / dt : 0;

    /* Camera rig */
    const index = Math.min(Math.floor(progress), count - 1);
    const blend = smooth01((progress - index - C.DWELL) / (1 - 2 * C.DWELL));
    evalPath(index, blend, rigPos);
    rigQuat.slerpQuaternions(station(index).quat, station(index + 1).quat, blend);
    const shadeA = textSide(station(index));
    uniforms.uShade.value = shadeA + (textSide(station(index + 1)) - shadeA) * blend;

    /* Warp (E7) */
    if (firstFrame) prevRigPos.copy(rigPos);
    v1.subVectors(rigPos, prevRigPos);
    if (v1.lengthSq() > 1e-8) uniforms.uWarpDir.value.lerp(v1.normalize(), 0.15).normalize();
    prevRigPos.copy(rigPos);
    const warpTarget =
      mode === 'high'
        ? Math.max(
            ramp(C.WARP_SCROLL_START, C.WARP_SCROLL_FULL, scrollSpeed),
            ramp(C.WARP_TRAVEL_START, C.WARP_TRAVEL_FULL, travel),
          )
        : 0;
    warp += (warpTarget - warp) * damp(warpTarget > warp ? C.WARP_RISE : C.WARP_FALL, dt);
    uniforms.uWarp.value = warp;
    const nextFov = C.FOV_DEG + warp * C.WARP_FOV_KICK;
    if (Math.abs(nextFov - fov) > 0.001) {
      fov = nextFov;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    /* Pointer (E2) */
    const slow = damp(C.POINTER_DAMPING, dt);
    const fast = damp(12, dt);
    parallaxX += (pointerX * pointerActive - parallaxX) * slow;
    parallaxY += (pointerY * pointerActive - parallaxY) * slow;
    const glow = uniforms.uPointer.value;
    glow.x += (pointerX - glow.x) * fast;
    glow.y += (pointerY - glow.y) * fast;
    uniforms.uPointerOn.value += (pointerActive - uniforms.uPointerOn.value) * slow;

    /* Final camera pose: rig + pointer parallax + idle sway */
    const time = uniforms.uTime.value * C.IDLE_SWAY_SPEED;
    v1.set(1, 0, 0).applyQuaternion(rigQuat);
    v2.set(0, 1, 0).applyQuaternion(rigQuat);
    camera.position
      .copy(rigPos)
      .addScaledVector(v1, parallaxX * C.POINTER_PARALLAX_POS + Math.sin(time) * C.IDLE_SWAY)
      .addScaledVector(v2, parallaxY * C.POINTER_PARALLAX_POS + Math.cos(time * 0.8) * C.IDLE_SWAY);
    euler.set(-parallaxY * C.POINTER_PARALLAX_ROT, parallaxX * C.POINTER_PARALLAX_ROT, 0);
    camera.quaternion.copy(rigQuat).multiply(offsetQuat.setFromEuler(euler));

    world.update(dt, camera);
    renderer.render(world.scene, camera);

    if (firstFrame) {
      firstFrame = false;
      root.dataset.scene = 'ready';
    }

    /* FPS, stats, auto-downgrade */
    if (counted) {
      statFrames++;
      statTime += rawDt;
    }
    if (statTime >= C.FPS_WINDOW_S) {
      const fps = statFrames / statTime;
      statFrames = 0;
      statTime = 0;
      windows++;
      stats.fps = Math.round(fps * 10) / 10;
      stats.frames = frames;
      if (!locked && windows > C.FPS_WARMUP_WINDOWS) {
        if (mode === 'high') {
          slowWindows = fps < C.FPS_HIGH_MIN ? slowWindows + 1 : 0;
          if (slowWindows >= C.FPS_HIGH_WINDOWS) downgrade();
        } else {
          slowWindows = fps < C.FPS_LOW_MIN ? slowWindows + 1 : 0;
          if (slowWindows >= C.FPS_LOW_WINDOWS) {
            dispose();
            setTier('none');
          }
        }
      }
    }
  };

  const play = (): void => {
    if (running || disposed || document.hidden) return;
    running = true;
    last = performance.now();
    statFrames = 0;
    statTime = 0;
    raf = requestAnimationFrame(frame);
  };
  const pause = (): void => {
    running = false;
    cancelAnimationFrame(raf);
  };

  /* ---- Listeners ---- */
  const onVisibility = (): void => {
    if (document.hidden) pause();
    else play();
  };
  const onResize = (): void => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, C.RESIZE_DEBOUNCE_MS);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    pointerX = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    pointerY = 1 - (event.clientY / Math.max(1, window.innerHeight)) * 2;
    pointerActive = 1;
  };
  const onPointerLeave = (): void => {
    pointerActive = 0;
  };
  const onContextLost = (): void => {
    dispose();
    setTier('none');
  };
  const layoutObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => (dirty = true)) : null;

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    pause();
    window.clearTimeout(resizeTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('blur', onPointerLeave);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    layoutObserver?.disconnect();
    delete root.dataset.scene;
    delete window.__sceneStats;
    try {
      world.dispose();
      // Leave a transparent canvas (the CSS fallback shows) and a default GL state for the next init().
      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.resetState();
    } catch {
      // The context is lost: there is nothing to clear.
    }
    renderer.dispose(); // keeps the WebGL context alive: init() can use the canvas again
  }

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize, { passive: true });
  canvas.addEventListener('webglcontextlost', onContextLost);
  if (finePointer) {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    root.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('blur', onPointerLeave);
  }
  layoutObserver?.observe(document.body);

  resize();
  play();
  return dispose;
}
