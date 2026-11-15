/*
 * world.ts — builds the objects of the ORBIT scene: sky + nebula, stars, dust,
 * sun + corona, planets (+ glow shell, ring, moon), orbit lines, far markers.
 *
 * `createWorld()` allocates everything once. `update()` allocates nothing.
 * `dispose()` frees every geometry, material, texture, and render target.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  LinearSRGBColorSpace,
  LineSegments,
  Mesh,
  PlaneGeometry,
  Points,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { Material, PerspectiveCamera, WebGLRenderer } from 'three';
import * as C from './config';
import * as S from './shaders';

export interface PlanetSpec {
  readonly radius: number;
  readonly seed: number;
  readonly rings: boolean;
  readonly hue: number;
  /** Stage accent as `#rgb` / `#rrggbb`, or null. */
  readonly accent: string | null;
}

export interface PlanetInfo {
  readonly position: Vector3;
  readonly radius: number;
  /** Orbit angle of the planet around the sun. */
  readonly theta: number;
  /** Unit light direction of the planet shaders (world space). The camera rig sets it. */
  readonly lightDir: Vector3;
}

interface Uniform<T> {
  value: T;
}

export interface SharedUniforms {
  readonly uTime: Uniform<number>;
  readonly uSkyTime: Uniform<number>;
  readonly uPx: Uniform<number>;
  readonly uAspect: Uniform<number>;
  readonly uRes: Uniform<Vector2>;
  readonly uPointer: Uniform<Vector2>;
  readonly uPointerOn: Uniform<number>;
  readonly uWarp: Uniform<number>;
  readonly uWarpDir: Uniform<Vector3>;
  readonly uDim: Uniform<number>;
  /** Text side of the screen: -1 left, +1 right, 0 none. */
  readonly uShade: Uniform<number>;
}

export interface World {
  readonly scene: Scene;
  readonly planets: readonly PlanetInfo[];
  readonly uniforms: SharedUniforms;
  update(dt: number, camera: PerspectiveCamera): void;
  /** Runtime downgrade: fewer points, no moons, static nebula. */
  setLow(): void;
  dispose(): void;
}

const u = <T>(value: T): Uniform<T> => ({ value });

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Display-space color: the sRGB values go to the shader unchanged. */
const raw = (hex: string): Color => new Color().setStyle(hex, LinearSRGBColorSpace);
const rawHsl = (hueDeg: number, s: number, l: number): Color =>
  new Color().setHSL((((hueDeg % 360) + 360) % 360) / 360, s, l, LinearSRGBColorSpace);

/** Small deterministic PRNG (mulberry32). */
const prng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface Spinner {
  readonly spin: Mesh;
  readonly moonPivot: Group | null;
  readonly speed: number;
}

export function createWorld(renderer: WebGLRenderer, tier: 'high' | 'low', specs: readonly PlanetSpec[]): World {
  const high = tier === 'high';
  const octaves = high ? 5 : 3;
  const scene = new Scene();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const spinners: Spinner[] = [];
  const moons: Mesh[] = [];
  const planets: PlanetInfo[] = [];
  let animateSky = high;

  const uniforms: SharedUniforms = {
    uTime: u(0),
    uSkyTime: u(0),
    uPx: u(1),
    uAspect: u(1),
    uRes: u(new Vector2(1, 1)),
    uPointer: u(new Vector2(0, 0)),
    uPointerOn: u(0),
    uWarp: u(0),
    uWarpDir: u(new Vector3(0, 0, -1)),
    uDim: u(1),
    uShade: u(0),
  };

  const geo = <T extends BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const mat = (m: ShaderMaterial): ShaderMaterial => {
    materials.push(m);
    return m;
  };

  /* ---- Nebula: bake once to an equirect texture ---- */
  const size = high ? C.NEBULA_SIZE_HIGH : C.NEBULA_SIZE_LOW;
  const nebula = new WebGLRenderTarget(size[0], size[1], {
    depthBuffer: false,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
  });
  {
    const bakeGeo = new PlaneGeometry(2, 2);
    const bakeMat = new ShaderMaterial({
      defines: { OCT: 5 },
      uniforms: {
        uPink: u(raw(C.NEBULA_PINK)),
        uBlue: u(raw(C.NEBULA_BLUE)),
        uPurple: u(raw(C.NEBULA_PURPLE)),
        uSeed: u(3.7),
      },
      vertexShader: S.BAKE_VERT,
      fragmentShader: S.BAKE_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(bakeGeo, bakeMat);
    quad.frustumCulled = false;
    const bakeScene = new Scene();
    bakeScene.add(quad);
    renderer.setRenderTarget(nebula);
    renderer.render(bakeScene, new Camera());
    renderer.setRenderTarget(null);
    bakeGeo.dispose();
    bakeMat.dispose();
  }

  /* ---- Sky sphere (follows the camera) ---- */
  const sky = new Mesh(
    geo(new SphereGeometry(1, 32, 16)),
    mat(
      new ShaderMaterial({
        uniforms: {
          uMap: u(nebula.texture),
          uSpace: u(raw(C.CLEAR_COLOR)),
          uGlowColor: u(raw(C.POINTER_GLOW_COLOR)),
          uIntensity: u(C.NEBULA_INTENSITY),
          uDrift: u(C.NEBULA_DRIFT),
          uGlow: u(C.POINTER_GLOW),
          uShadeStrength: u(C.NEBULA_TEXT_SHADE),
          uVignette: u(C.NEBULA_VIGNETTE),
          uShade: uniforms.uShade,
          uSkyTime: uniforms.uSkyTime,
          uPointerOn: uniforms.uPointerOn,
          uPointer: uniforms.uPointer,
          uAspect: uniforms.uAspect,
          uRes: uniforms.uRes,
        },
        vertexShader: S.SKY_VERT,
        fragmentShader: S.SKY_FRAG,
        side: BackSide,
        depthTest: false,
        depthWrite: false,
      }),
    ),
  );
  sky.scale.setScalar(C.STAR_RADIUS);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);

  /* ---- Stars ---- */
  const starCount = high ? C.STARS_HIGH : C.STARS_LOW;
  const starGeo = geo(new BufferGeometry());
  {
    const rand = prng(1337);
    const pos = new Float32Array(starCount * 3);
    const data = new Float32Array(starCount * 4);
    const col = new Float32Array(starCount * 3);
    const tints: readonly Color[] = [raw('#ffffff'), raw('#cfe6ff'), raw('#ffd9f4'), raw('#fff0d2'), raw('#b8a6ff')];
    for (let i = 0; i < starCount; i++) {
      const y = rand() * 2 - 1;
      const phi = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - y * y);
      pos[i * 3] = r * Math.cos(phi);
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = r * Math.sin(phi);
      const big = Math.pow(rand(), 7);
      data[i * 4] = C.STAR_SIZE_MIN + big * (C.STAR_SIZE_MAX - C.STAR_SIZE_MIN) + rand() * 0.5;
      data[i * 4 + 1] = 0.3 + rand() * 0.45 + big * 0.5;
      data[i * 4 + 2] = rand() * Math.PI * 2;
      data[i * 4 + 3] = Math.floor(rand() * 3);
      const tint = tints[Math.floor(rand() * tints.length)] ?? tints[0];
      col[i * 3] = tint?.r ?? 1;
      col[i * 3 + 1] = tint?.g ?? 1;
      col[i * 3 + 2] = tint?.b ?? 1;
    }
    starGeo.setAttribute('position', new BufferAttribute(pos, 3));
    starGeo.setAttribute('aData', new BufferAttribute(data, 4));
    starGeo.setAttribute('aColor', new BufferAttribute(col, 3));
  }
  const stars = new Points(
    starGeo,
    mat(
      new ShaderMaterial({
        uniforms: {
          uRadius: u(C.STAR_RADIUS * 0.9),
          uStretch: u(C.WARP_STRETCH),
          uParallax: u(C.STAR_LAYER_PARALLAX),
          uTwinkle: u(C.STAR_TWINKLE),
          uTime: uniforms.uTime,
          uPx: uniforms.uPx,
          uWarp: uniforms.uWarp,
          uWarpDir: uniforms.uWarpDir,
          uAspect: uniforms.uAspect,
          uPointer: uniforms.uPointer,
          uPointerOn: uniforms.uPointerOn,
        },
        vertexShader: S.STAR_VERT,
        fragmentShader: S.STAR_FRAG,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    ),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -50;
  scene.add(stars);

  /* ---- Dust ---- */
  const dustCount = high ? C.DUST_HIGH : C.DUST_LOW;
  const dustGeo = geo(new BufferGeometry());
  {
    const rand = prng(4242);
    const pos = new Float32Array(dustCount * 3);
    const data = new Float32Array(dustCount * 4);
    const col = new Float32Array(dustCount * 3);
    const pink = raw(C.NEBULA_PINK);
    const blue = raw(C.NEBULA_BLUE);
    const tmp = new Color();
    for (let i = 0; i < dustCount; i++) {
      pos[i * 3] = rand() * C.DUST_BOX;
      pos[i * 3 + 1] = rand() * C.DUST_BOX;
      pos[i * 3 + 2] = rand() * C.DUST_BOX;
      data[i * 4] = 0.6 + rand() * 1.4;
      data[i * 4 + 1] = 0.35 + rand() * 0.65;
      data[i * 4 + 2] = rand() * Math.PI * 2;
      data[i * 4 + 3] = 0;
      tmp.copy(pink).lerp(blue, rand());
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }
    dustGeo.setAttribute('position', new BufferAttribute(pos, 3));
    dustGeo.setAttribute('aData', new BufferAttribute(data, 4));
    dustGeo.setAttribute('aColor', new BufferAttribute(col, 3));
  }
  const dust = new Points(
    dustGeo,
    mat(
      new ShaderMaterial({
        uniforms: {
          uBox: u(C.DUST_BOX),
          uOpacity: u(C.DUST_OPACITY),
          uRepel: u(C.POINTER_REPEL),
          uFalloff: u(C.POINTER_FALLOFF),
          uTime: uniforms.uTime,
          uPx: uniforms.uPx,
          uAspect: uniforms.uAspect,
          uPointer: uniforms.uPointer,
          uPointerOn: uniforms.uPointerOn,
        },
        vertexShader: S.DUST_VERT,
        fragmentShader: S.DUST_FRAG,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    ),
  );
  dust.frustumCulled = false;
  dust.renderOrder = 10;
  scene.add(dust);

  /* ---- Shared sphere ---- */
  const sphere = geo(high ? new SphereGeometry(1, 64, 48) : new SphereGeometry(1, 40, 28));

  /* ---- Sun + corona ---- */
  const sunMid = raw(C.SUN_MID);
  const sunEdge = raw(C.SUN_EDGE);
  const sun = new Mesh(
    sphere,
    mat(
      new ShaderMaterial({
        defines: { OCT: high ? 4 : 3 },
        uniforms: {
          uCore: u(raw(C.SUN_CORE)),
          uMid: u(sunMid),
          uEdge: u(sunEdge),
          uFlow: u(C.SUN_FLOW_SPEED),
          uIntensity: u(C.SUN_INTENSITY),
          uTime: uniforms.uTime,
        },
        vertexShader: S.BODY_VERT,
        fragmentShader: S.SUN_FRAG,
      }),
    ),
  );
  sun.scale.setScalar(C.SUN_RADIUS);
  scene.add(sun);

  const corona = new Mesh(
    geo(new PlaneGeometry(2, 2)),
    mat(
      new ShaderMaterial({
        uniforms: {
          uMid: u(sunMid),
          uEdge: u(sunEdge),
          uScale: u(C.CORONA_SCALE),
          uIntensity: u(C.CORONA_INTENSITY),
          uTime: uniforms.uTime,
        },
        vertexShader: S.CORONA_VERT,
        fragmentShader: S.CORONA_FRAG,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    ),
  );
  corona.scale.setScalar(C.SUN_RADIUS * C.CORONA_SCALE);
  corona.renderOrder = -20;
  scene.add(corona);

  /* ---- Planets ---- */
  const atmoEdge = Math.sqrt(1 - 1 / (C.ATMO_SCALE * C.ATMO_SCALE));
  const accents: Color[] = [];
  specs.forEach((spec, index) => {
    const r = C.ORBIT_START + index * C.ORBIT_STEP;
    const theta = C.ORBIT_ANGLE_START + index * C.ORBIT_ANGLE_STEP;
    const position = new Vector3(r * Math.cos(theta), Math.sin(index * 1.7 + 0.6) * C.ORBIT_Y_SPREAD, r * Math.sin(theta));
    const radius = spec.radius;

    const accent = spec.accent !== null && HEX.test(spec.accent) ? raw(spec.accent) : rawHsl(spec.hue, 0.75, 0.68);
    accents.push(accent);
    const colB = rawHsl(spec.hue + 28, 0.62, 0.42);
    const colC = rawHsl(spec.hue - 24, 0.55, 0.1);
    const colHi = accent.clone().lerp(raw('#ffffff'), 0.55);
    // Start value: the real sun direction. The camera rig replaces it with the key light.
    const sunDir = position.clone().multiplyScalar(-1).normalize();
    planets.push({ position, radius, theta, lightDir: sunDir });
    const type = spec.rings ? 0 : Math.abs(Math.round(spec.seed)) % 3;

    const group = new Group();
    group.position.copy(position);
    group.scale.setScalar(radius);
    group.rotation.z = spec.rings ? C.RING_TILT : (((Math.abs(spec.seed) * 37) % 100) / 100 - 0.5) * 0.6;
    group.rotation.x = spec.rings ? 0.18 : 0;
    scene.add(group);

    const body = new Mesh(
      sphere,
      mat(
        new ShaderMaterial({
          defines: { OCT: octaves, PLANET_TYPE: type },
          uniforms: {
            uColA: u(accent),
            uColB: u(colB),
            uColC: u(colC),
            uColHi: u(colHi),
            uAccent: u(accent),
            uSunDir: u(sunDir),
            uSeed: u(spec.seed % 100),
            uAmbient: u(C.PLANET_AMBIENT),
            uRim: u(C.PLANET_RIM),
            uTime: uniforms.uTime,
            uDim: uniforms.uDim,
          },
          vertexShader: S.BODY_VERT,
          fragmentShader: S.PLANET_FRAG,
        }),
      ),
    );
    body.rotation.y = spec.seed;
    group.add(body);

    const atmo = new Mesh(
      sphere,
      mat(
        new ShaderMaterial({
          uniforms: {
            uAccent: u(accent),
            uSunDir: u(sunDir),
            uEdge: u(atmoEdge),
            uIntensity: u(C.ATMO_INTENSITY),
            uDim: uniforms.uDim,
          },
          vertexShader: S.BODY_VERT,
          fragmentShader: S.ATMO_FRAG,
          side: BackSide,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    atmo.scale.setScalar(C.ATMO_SCALE);
    atmo.renderOrder = 1;
    group.add(atmo);

    if (spec.rings) {
      const ring = new Mesh(
        geo(new RingGeometry(C.RING_INNER, C.RING_OUTER, high ? 128 : 72, 1)),
        mat(
          new ShaderMaterial({
            uniforms: {
              uColA: u(colHi),
              uColB: u(colB),
              uSunDir: u(sunDir),
              uCenter: u(position),
              uPlanetR: u(radius),
              uInner: u(C.RING_INNER),
              uOuter: u(C.RING_OUTER),
              uSeed: u(spec.seed % 100),
              uOpacity: u(C.RING_OPACITY),
              uDim: uniforms.uDim,
            },
            vertexShader: S.RING_VERT,
            fragmentShader: S.RING_FRAG,
            side: DoubleSide,
            transparent: true,
            depthWrite: false,
          }),
        ),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 2;
      group.add(ring);
    }

    let moonPivot: Group | null = null;
    if (high && radius >= C.MOON_MIN_RADIUS) {
      moonPivot = new Group();
      moonPivot.rotation.x = 0.35;
      moonPivot.rotation.y = spec.seed;
      const moon = new Mesh(
        sphere,
        mat(
          new ShaderMaterial({
            defines: { OCT: 3, PLANET_TYPE: 3 },
            uniforms: {
              uColA: u(raw('#c4bdd2')),
              uColB: u(raw('#8d86a0')),
              uColC: u(raw('#3a3546')),
              uColHi: u(raw('#ffffff')),
              uAccent: u(accent),
              uSunDir: u(sunDir),
              uSeed: u((spec.seed % 100) + 11),
              uAmbient: u(C.PLANET_AMBIENT),
              uRim: u(C.PLANET_RIM * 0.25),
              uTime: uniforms.uTime,
              uDim: uniforms.uDim,
            },
            vertexShader: S.BODY_VERT,
            fragmentShader: S.PLANET_FRAG,
          }),
        ),
      );
      moon.position.set(C.MOON_ORBIT, 0, 0);
      moon.scale.setScalar(C.MOON_SIZE);
      moonPivot.add(moon);
      group.add(moonPivot);
      moons.push(moon);
    }

    spinners.push({ spin: body, moonPivot, speed: C.PLANET_SPIN * (0.7 + ((spec.seed * 13) % 10) / 12) });
  });

  /* ---- Orbit lines + far markers ---- */
  if (planets.length > 0) {
    const segments = high ? 192 : 96;
    const linePos = new Float32Array(planets.length * segments * 6);
    const lineCol = new Float32Array(planets.length * segments * 6);
    const markPos = new Float32Array(planets.length * 3);
    const markCol = new Float32Array(planets.length * 3);
    planets.forEach((planet, index) => {
      const accent = accents[index];
      const cr = accent?.r ?? 1;
      const cg = accent?.g ?? 1;
      const cb = accent?.b ?? 1;
      const r = Math.hypot(planet.position.x, planet.position.z);
      const y = planet.position.y;
      for (let s = 0; s < segments; s++) {
        const a0 = (s / segments) * Math.PI * 2;
        const a1 = ((s + 1) / segments) * Math.PI * 2;
        const o = (index * segments + s) * 6;
        linePos[o] = r * Math.cos(a0);
        linePos[o + 1] = y;
        linePos[o + 2] = r * Math.sin(a0);
        linePos[o + 3] = r * Math.cos(a1);
        linePos[o + 4] = y;
        linePos[o + 5] = r * Math.sin(a1);
        for (let k = 0; k < 2; k++) {
          lineCol[o + k * 3] = cr;
          lineCol[o + k * 3 + 1] = cg;
          lineCol[o + k * 3 + 2] = cb;
        }
      }
      markPos[index * 3] = planet.position.x;
      markPos[index * 3 + 1] = planet.position.y;
      markPos[index * 3 + 2] = planet.position.z;
      markCol[index * 3] = cr;
      markCol[index * 3 + 1] = cg;
      markCol[index * 3 + 2] = cb;
    });

    const lineGeo = geo(new BufferGeometry());
    lineGeo.setAttribute('position', new BufferAttribute(linePos, 3));
    lineGeo.setAttribute('aColor', new BufferAttribute(lineCol, 3));
    const lines = new LineSegments(
      lineGeo,
      mat(
        new ShaderMaterial({
          uniforms: { uNear: u(C.ORBIT_FADE_NEAR), uFar: u(C.ORBIT_FADE_FAR), uOpacity: u(C.ORBIT_LINE_OPACITY) },
          vertexShader: S.ORBIT_VERT,
          fragmentShader: S.ORBIT_FRAG,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    lines.frustumCulled = false;
    lines.renderOrder = -40;
    scene.add(lines);

    const markGeo = geo(new BufferGeometry());
    markGeo.setAttribute('position', new BufferAttribute(markPos, 3));
    markGeo.setAttribute('aColor', new BufferAttribute(markCol, 3));
    const markers = new Points(
      markGeo,
      mat(
        new ShaderMaterial({
          uniforms: {
            uSize: u(C.MARKER_SIZE_PX),
            uNear: u(C.MARKER_FADE_NEAR),
            uFar: u(C.MARKER_FADE_FAR),
            uPx: uniforms.uPx,
          },
          vertexShader: S.MARKER_VERT,
          fragmentShader: S.MARKER_FRAG,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    markers.frustumCulled = false;
    markers.renderOrder = -30;
    scene.add(markers);
  }

  return {
    scene,
    planets,
    uniforms,
    update(dt, camera) {
      uniforms.uTime.value += dt;
      if (animateSky) uniforms.uSkyTime.value += dt;
      sky.position.copy(camera.position);
      corona.quaternion.copy(camera.quaternion);
      for (const item of spinners) {
        item.spin.rotation.y += dt * item.speed;
        if (item.moonPivot !== null) item.moonPivot.rotation.y += dt * C.MOON_SPEED;
      }
    },
    setLow() {
      animateSky = false;
      starGeo.setDrawRange(0, Math.min(starCount, C.STARS_LOW));
      dustGeo.setDrawRange(0, Math.min(dustCount, C.DUST_LOW));
      for (const moon of moons) moon.visible = false;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      nebula.dispose();
      scene.clear();
    },
  };
}
