/*
 * shaders.ts — GLSL sources of the ORBIT scene (three ShaderMaterial, WebGL2).
 *
 * Rules: float literals always have a decimal point (GLSL ES has no int -> float
 * conversion). smoothstep always gets edge0 < edge1. Colors are display-space
 * sRGB; no shader includes the three color-space chunk.
 * `OCT` (fbm octaves) comes from material defines. The planet type is a uniform.
 */

/** Value noise + fbm. Needs `#define OCT n`. */
const NOISE = /* glsl */ `
#define K_PI 3.14159265
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
float fbm(vec3 p) {
  float amp = 0.5;
  float sum = 0.0;
  for (int i = 0; i < OCT; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03 + vec3(17.1, 3.7, 9.2);
    amp *= 0.5;
  }
  return sum;
}
`;

/* ---------- Shared mesh vertex shader (sun, planets, moons, glow shell) ---------- */
export const BODY_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
void main() {
  vObj = position;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/* ---------- Nebula bake (one time, to an equirect texture) ---------- */
export const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const BAKE_FRAG = /* glsl */ `
${NOISE}
uniform vec3 uPink;
uniform vec3 uBlue;
uniform vec3 uPurple;
uniform float uSeed;
varying vec2 vUv;
void main() {
  float phi = (vUv.x * 2.0 - 1.0) * K_PI;
  float th = (vUv.y - 0.5) * K_PI;
  vec3 d = vec3(cos(th) * cos(phi), sin(th), cos(th) * sin(phi));
  vec3 q = d * 1.7 + vec3(uSeed);
  vec3 w = vec3(fbm(q), fbm(q + vec3(5.2, 1.3, 8.1)), fbm(q + vec3(2.7, 9.1, 4.4)));
  float n1 = fbm(q * 1.3 + w * 1.9);
  float n2 = fbm(q * 2.0 - w * 1.5 + vec3(11.0));
  float n3 = fbm(q * 0.9 + w * 1.1 + vec3(23.0));
  float lanes = 0.35 + 0.65 * smoothstep(0.3, 0.62, fbm(q * 3.1 + w * 2.2 + vec3(40.0)));
  vec3 col = uPurple * smoothstep(0.3, 0.7, n3) * 0.7;
  col += uPink * pow(smoothstep(0.38, 0.72, n1), 1.5) * 0.8;
  col += uBlue * pow(smoothstep(0.4, 0.74, n2), 1.5) * 0.65;
  col *= lanes;
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------- Sky sphere (nebula texture + pointer glow) ---------- */
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const SKY_FRAG = /* glsl */ `
#define K_PI 3.14159265
uniform sampler2D uMap;
uniform vec3 uSpace;
uniform vec3 uGlowColor;
uniform float uIntensity;
uniform float uSkyTime;
uniform float uDrift;
uniform float uGlow;
uniform float uPointerOn;
uniform float uAspect;
uniform float uShade;
uniform float uShadeStrength;
uniform float uVignette;
uniform vec2 uPointer;
uniform vec2 uRes;
varying vec3 vDir;
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
void main() {
  vec3 d = normalize(vDir);
  vec2 uv = vec2(atan(d.z, d.x) / (2.0 * K_PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / K_PI + 0.5);
  float shift = uSkyTime * uDrift;
  vec3 a = texture2D(uMap, vec2(uv.x + shift, uv.y)).rgb;
  vec3 b = texture2D(uMap, vec2(uv.x - shift * 0.7 + 0.37, 1.0 - uv.y)).rgb;
  vec2 sp = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  // uShade: -1 = text on the left, +1 = text on the right, 0 = no text side.
  float textSide = smoothstep(-0.35, 0.75, sp.x * uShade) * abs(uShade);
  float dimming = (1.0 - uShadeStrength * textSide) * (1.0 - uVignette * smoothstep(0.5, 1.5, dot(sp, sp)));
  vec3 col = uSpace + (a * 0.7 + b * 0.45) * (uIntensity * dimming);
  vec2 pd = (sp - uPointer) * vec2(uAspect, 1.0);
  col += uGlowColor * (uGlow * uPointerOn * exp(-dot(pd, pd) * 5.0));
  col += (hash12(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------- Stars (points; twinkle, depth layers, warp streaks) ---------- */
export const STAR_VERT = /* glsl */ `
attribute vec4 aData; // size px, brightness, twinkle phase, depth layer
attribute vec3 aColor;
uniform float uRadius;
uniform float uTime;
uniform float uPx;
uniform float uWarp;
uniform float uStretch;
uniform float uParallax;
uniform float uTwinkle;
uniform float uAspect;
uniform float uPointerOn;
uniform vec2 uPointer;
uniform vec3 uWarpDir;
varying vec3 vColor;
varying vec2 vDir;
varying float vStretch;
void main() {
  float follow = 1.0 - aData.w * uParallax;
  vec3 wp = position * uRadius + cameraPosition * follow;
  vec4 clip = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vec4 clip2 = projectionMatrix * viewMatrix * vec4(wp - uWarpDir * (uRadius * 0.12), 1.0);
  vec2 n1 = clip.xy / max(clip.w, 0.001);
  vec2 n2 = clip2.xy / max(clip2.w, 0.001);
  vec2 dl = (n2 - n1) * vec2(uAspect, 1.0);
  float len = length(dl);
  vDir = len > 0.00001 ? dl / len : vec2(1.0, 0.0);
  float stretch = 1.0 + uWarp * clamp(len * 5.0, 0.0, 1.0) * (uStretch - 1.0);
  vStretch = stretch;
  float tw = 1.0 - uTwinkle + uTwinkle * sin(uTime * (0.8 + aData.z * 0.5) + aData.z * 6.0);
  vec2 pd = (n1 - uPointer) * vec2(uAspect, 1.0);
  float boost = uPointerOn * exp(-dot(pd, pd) * 7.0);
  vColor = aColor * (aData.y * tw * (1.0 + boost * 0.9) / sqrt(stretch));
  gl_PointSize = aData.x * uPx * stretch;
  gl_Position = clip;
}
`;

export const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying vec2 vDir;
varying float vStretch;
void main() {
  vec2 c = gl_PointCoord - vec2(0.5);
  c.y = -c.y;
  float along = dot(c, vDir);
  float across = dot(c, vec2(-vDir.y, vDir.x));
  float d = length(vec2(along, across * vStretch)) * 2.0;
  float alpha = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(vColor, alpha * alpha);
}
`;

/* ---------- Dust (points in a wrap box around the camera; pointer repulsion) ---------- */
export const DUST_VERT = /* glsl */ `
attribute vec4 aData; // size, brightness, phase, unused
attribute vec3 aColor;
uniform float uBox;
uniform float uTime;
uniform float uPx;
uniform float uAspect;
uniform float uPointerOn;
uniform float uRepel;
uniform float uFalloff;
uniform vec2 uPointer;
varying vec3 vColor;
void main() {
  vec3 drift = vec3(sin(uTime * 0.05 + aData.z), cos(uTime * 0.04 + aData.z * 1.7), sin(uTime * 0.03 + aData.z * 2.3)) * 0.6;
  vec3 rel = mod(position + drift - cameraPosition + vec3(uBox * 0.5), vec3(uBox)) - vec3(uBox * 0.5);
  vec4 mv = viewMatrix * vec4(rel + cameraPosition, 1.0);
  vec4 clip = projectionMatrix * mv;
  float dist = length(rel);
  vec2 ndc = clip.xy / max(clip.w, 0.001);
  vec2 pd = (ndc - uPointer) * vec2(uAspect, 1.0);
  float infl = uPointerOn * exp(-dot(pd, pd) * uFalloff);
  vec2 push = normalize(pd + vec2(0.00001)) * (infl * uRepel);
  clip.xy += push / vec2(uAspect, 1.0) * clip.w;
  float fade = smoothstep(0.6, 3.5, dist) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, dist));
  vColor = aColor * (aData.y * fade * (1.0 + infl * 2.0));
  gl_PointSize = clamp(aData.x * uPx * 16.0 / max(-mv.z, 0.5), 1.0, 7.0 * uPx);
  gl_Position = clip;
}
`;

export const DUST_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float alpha = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(vColor, alpha * alpha * uOpacity);
}
`;

/* ---------- Planet markers (glow dots when a planet is far) ---------- */
export const MARKER_VERT = /* glsl */ `
attribute vec3 aColor;
uniform float uPx;
uniform float uSize;
uniform float uNear;
uniform float uFar;
varying vec4 vColor;
void main() {
  float dist = distance(position, cameraPosition);
  vColor = vec4(aColor, smoothstep(uNear, uFar, dist));
  gl_PointSize = uSize * uPx;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const MARKER_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;
  float alpha = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(vColor.rgb, alpha * alpha * vColor.a);
}
`;

/* ---------- Orbit lines ---------- */
export const ORBIT_VERT = /* glsl */ `
attribute vec3 aColor;
uniform float uNear;
uniform float uFar;
uniform float uOpacity;
varying vec4 vColor;
void main() {
  float dist = distance(position, cameraPosition);
  vColor = vec4(aColor, uOpacity * smoothstep(uNear, uFar, dist));
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

export const ORBIT_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  gl_FragColor = vColor;
}
`;

/* ---------- Sun surface ---------- */
export const SUN_FRAG = /* glsl */ `
${NOISE}
uniform vec3 uCore;
uniform vec3 uMid;
uniform vec3 uEdge;
uniform float uTime;
uniform float uFlow;
uniform float uIntensity;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 p = normalize(vObj);
  float t = uTime * uFlow;
  float n = fbm(p * 3.0 + vec3(0.0, t, 0.0));
  float n2 = fbm(p * 7.0 + vec3(n * 2.0) - vec3(t * 1.5, 0.0, t));
  float v = n * 0.6 + n2 * 0.55;
  vec3 col = mix(uEdge, uMid, smoothstep(0.25, 0.55, v));
  col = mix(col, uCore, smoothstep(0.5, 0.85, v));
  vec3 viewDir = normalize(cameraPosition - vW);
  float fres = 1.0 - max(dot(normalize(vN), viewDir), 0.0);
  col += uMid * (fres * fres * 0.55);
  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;

/* ---------- Sun corona (camera-facing quad, additive) ---------- */
export const CORONA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const CORONA_FRAG = /* glsl */ `
uniform vec3 uMid;
uniform vec3 uEdge;
uniform float uTime;
uniform float uScale;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  float rs = max(r * uScale, 1.0);
  float ang = atan(c.y, c.x);
  float rays = 0.88 + 0.12 * sin(ang * 7.0 + uTime * 0.1) * sin(ang * 13.0 - uTime * 0.07);
  float glow = exp(-(rs - 1.0) * 1.7) * 0.9 + 0.1 / (rs * rs);
  glow *= rays * (1.0 - smoothstep(0.5, 1.0, r));
  vec3 col = mix(uMid, uEdge, smoothstep(1.0, 2.4, rs));
  gl_FragColor = vec4(col * uIntensity, glow);
}
`;

/* ---------- Planet surface. uType: 0 gas bands, 1 rocky, 2 swirl, 3 moon (one program) ---------- */
export const PLANET_FRAG = /* glsl */ `
${NOISE}
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColC;
uniform vec3 uColHi;
uniform vec3 uAccent;
uniform vec3 uSunDir;
uniform float uSeed;
uniform float uType; // 0 gas bands, 1 rocky, 2 swirl, 3 moon
uniform float uTime;
uniform float uDim;
uniform float uAmbient;
uniform float uRim;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 p = normalize(vObj);
  vec3 sp = p + vec3(uSeed * 1.7, uSeed * 0.3, -uSeed);
  vec3 col;
  float gloss = 0.0;
  if (uType < 0.5) {
  float warp = fbm(sp * vec3(2.0, 6.0, 2.0));
  float lat = p.y * 6.5 + (warp - 0.5) * 2.4;
  float band = sin(lat * K_PI) * 0.5 + 0.5;
  float grain = fbm(vec3(sp.x * 3.0, p.y * 22.0, sp.z * 3.0));
  col = mix(uColC, uColA, smoothstep(0.1, 0.9, band));
  col = mix(col, uColB, grain * 0.65);
  float storm = smoothstep(0.62, 0.72, fbm(sp * 4.5 + vec3(warp)));
  col = mix(col, uColHi, storm * 0.45);
  } else if (uType < 1.5) {
  float h = fbm(sp * 2.4);
  float h2 = fbm(sp * 7.0 + vec3(h * 2.0));
  float land = smoothstep(0.44, 0.52, h + (h2 - 0.5) * 0.25);
  vec3 sea = mix(uColC, uColB, h2 * 0.8);
  vec3 ground = mix(uColA, uColHi, h2 * 0.8);
  col = mix(sea, ground, land);
  gloss = 1.0 - land;
  float cloud = smoothstep(0.52, 0.7, fbm(sp * 3.5 + vec3(uTime * 0.012, 0.0, h)));
  col = mix(col, vec3(0.95), cloud * 0.5);
  } else if (uType < 2.5) {
  vec3 q = sp * 1.8;
  vec3 w = vec3(fbm(q), fbm(q + vec3(3.1)), fbm(q + vec3(7.7)));
  float n = fbm(q * 1.5 + w * 2.5 + vec3(0.0, p.y * 2.0, 0.0));
  col = mix(uColC, uColA, smoothstep(0.25, 0.65, n));
  col = mix(col, uColB, smoothstep(0.45, 0.8, w.x));
  col = mix(col, uColHi, pow(n, 4.0) * 1.6);
  } else {
  float h = fbm(sp * 4.0);
  float crater = smoothstep(0.55, 0.6, fbm(sp * 9.0));
  col = mix(uColC, uColA, h) * (1.0 - crater * 0.35);
  }
  vec3 nrm = normalize(vN);
  vec3 viewDir = normalize(cameraPosition - vW);
  float ndl = dot(nrm, uSunDir);
  float day = smoothstep(-0.18, 0.55, ndl);
  float fres = pow(1.0 - max(dot(nrm, viewDir), 0.0), 3.0);
  vec3 shade = col * (uAmbient + day * 1.05);
  shade += uAccent * (0.05 * (1.0 - day));
  shade += uAccent * (fres * uRim * (0.25 + 0.75 * smoothstep(-0.4, 0.3, ndl)));
  vec3 hv = normalize(uSunDir + viewDir);
  shade += vec3(1.0) * (pow(max(dot(nrm, hv), 0.0), 40.0) * 0.25 * gloss * day);
  gl_FragColor = vec4(shade * uDim, 1.0);
}
`;

/* ---------- Atmosphere glow shell (back faces, additive) ---------- */
export const ATMO_FRAG = /* glsl */ `
uniform vec3 uAccent;
uniform vec3 uSunDir;
uniform float uEdge; // sqrt(1 - 1 / scale^2): the value of x at the planet limb
uniform float uIntensity;
uniform float uDim;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 nrm = normalize(vN);
  vec3 viewDir = normalize(cameraPosition - vW);
  float x = max(-dot(nrm, viewDir), 0.0);
  float glow = smoothstep(0.0, uEdge, x);
  glow *= glow;
  vec3 limb = nrm + viewDir * x;
  float side = dot(limb / max(length(limb), 0.0001), uSunDir);
  float sun = 0.2 + 0.8 * smoothstep(-0.6, 0.5, side);
  gl_FragColor = vec4(uAccent * (uIntensity * uDim), glow * sun);
}
`;

/* ---------- Planet ring ---------- */
export const RING_VERT = /* glsl */ `
varying float vR;
varying vec3 vW;
void main() {
  vR = length(position.xy);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const RING_FRAG = /* glsl */ `
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uSunDir;
uniform vec3 uCenter;
uniform float uPlanetR;
uniform float uInner;
uniform float uOuter;
uniform float uSeed;
uniform float uOpacity;
uniform float uDim;
varying float vR;
varying vec3 vW;
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}
void main() {
  float t = clamp((vR - uInner) / (uOuter - uInner), 0.0, 1.0);
  float bands = 0.5 + 0.5 * sin(t * 40.0 + noise1(t * 9.0 + uSeed) * 7.0);
  float coarse = noise1(t * 5.0 + uSeed * 1.3);
  float gap = smoothstep(0.015, 0.05, abs(t - 0.6));
  float border = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.9, 1.0, t));
  float alpha = border * gap * (0.25 + 0.45 * bands + 0.3 * coarse) * uOpacity;
  vec3 rel = vW - uCenter;
  float along = dot(rel, uSunDir);
  float off = length(rel - uSunDir * along);
  float shadow = along < 0.0 ? smoothstep(uPlanetR * 0.9, uPlanetR * 1.08, off) : 1.0;
  vec3 col = mix(uColB, uColA, bands * 0.6 + coarse * 0.4) * (0.12 + 0.88 * shadow);
  gl_FragColor = vec4(col * uDim, alpha);
}
`;
