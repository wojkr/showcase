/*
 * config.ts — all tunable constants of the ORBIT scene.
 *
 * Units: world units (sun radius = 5). Angles: radians, if not stated.
 * Screen positions: NDC, x and y from -1 (left / bottom) to +1 (right / top).
 * Screen radius: fraction of half the viewport height.
 * Colors: sRGB hex. The shaders work in display space (no color management).
 */

/* ---- Renderer ---- */
export const CLEAR_COLOR = '#0d0916';
export const DPR_HIGH = 1.5;
export const DPR_LOW = 1.0;
export const RESIZE_DEBOUNCE_MS = 150;
export const COMPILE_POLL_MS = 12; // start-up: interval of the shader-compile check
export const NARROW_BREAKPOINT_PX = 1024; // below: one-column layout

/* ---- Camera ---- */
export const FOV_DEG = 50;
export const CAM_NEAR = 0.1;
export const CAM_FAR = 2600;
export const CAM_DAMPING = 4.0; // 1/s; higher = the camera follows scroll faster
export const PATH_TENSION = 0.8; // 0 = straight flight lines, 1 = full Catmull-Rom curves
export const DWELL = 0.16; // 0..0.45; share of each transition where the camera holds the station
export const IDLE_SWAY = 0.05; // world units; slow camera drift (also on touch)
export const IDLE_SWAY_SPEED = 0.25; // rad/s

/* ---- Hero station (the sun) ---- */
// Wide screens: the sun sits in the lower-right corner. Its disc stays right of
// HERO_SUN_EDGE_X and below HERO_SUN_TOP_Y (NDC), so it never goes behind the title.
export const HERO_SUN_EDGE_X = 0.64; // left edge of the disc (0.64 = 82 % of the width)
export const HERO_SUN_TOP_Y = -0.16; // top edge of the disc (-0.16 = 58 % of the height)
export const HERO_SUN_SCREEN_RADIUS = 1.0;
export const HERO_SUN_NDC_NARROW: readonly [number, number] = [0.6, -0.85];
export const HERO_SUN_SCREEN_RADIUS_NARROW = 0.4;
export const HERO_VIEW_ANGLE = 0.95; // angle between the hero view and the sun direction of planet 1
export const HERO_PITCH = -0.08;

/* ---- Planet stations ---- */
export const PLANET_NDC_X = 0.66; // sign follows data-side (right = +)
export const PLANET_NDC_Y = 0.5;
export const PLANET_SCREEN_RADIUS = 0.7; // for a planet with `radius` = PLANET_REF_RADIUS
export const PLANET_REF_RADIUS = 1.3;
export const PLANET_SIZE_MIN = 0.78; // clamp of radius / PLANET_REF_RADIUS on screen
export const PLANET_SIZE_MAX = 1.2;
export const PLANET_NDC_NARROW: readonly [number, number] = [0.5, 0.72];
export const PLANET_SCREEN_RADIUS_NARROW = 0.26;
export const PLANET_DIM_NARROW = 0.6; // brightness of planets on narrow screens
export const PLANET_SUN_ANGLE = 2.15; // angle view-direction to sun-direction; > PI/2 = sun behind the camera = more lit
export const PLANET_PITCH = -0.06;
// Key light of a planet in the camera space of its station (art-directed, not the real sun).
// x: toward the media side (the terminator then faces the text column); y: up; z: toward the camera.
// More z = more of the lit side shows (0.6 = about 65 % lit).
export const PLANET_KEY_LIGHT: readonly [number, number, number] = [0.75, 0.25, 0.6];

/* ---- Pilot station (wide shot) ---- */
export const PILOT_DISTANCE = 150;
export const PILOT_FIT_ASPECT = 1.3; // below this aspect the camera moves back
export const PILOT_ELEVATION = 0.6;
export const PILOT_AZIMUTH_OFFSET = 0.7; // after the last planet
export const PILOT_NDC: readonly [number, number] = [0.12, 0.1]; // where the sun sits

/* ---- Orbits (world layout) ---- */
export const ORBIT_START = 26; // orbit radius of planet 1
export const ORBIT_STEP = 14;
export const ORBIT_ANGLE_START = 0.4;
export const ORBIT_ANGLE_STEP = 1.15;
export const ORBIT_Y_SPREAD = 3;
export const ORBIT_LINE_OPACITY = 0.2;
export const ORBIT_FADE_NEAR = 10; // an orbit line is invisible nearer than this
export const ORBIT_FADE_FAR = 70;
export const MARKER_SIZE_PX = 9; // glow dot of a far planet
export const MARKER_FADE_NEAR = 18;
export const MARKER_FADE_FAR = 70;

/* ---- Sun ---- */
export const SUN_RADIUS = 5;
export const SUN_CORE = '#fff3dc';
export const SUN_MID = '#ff9d6c';
export const SUN_EDGE = '#e7609c';
export const SUN_INTENSITY = 1.0;
export const SUN_FLOW_SPEED = 0.06;
export const CORONA_SCALE = 3.4; // corona radius / sun radius
export const CORONA_INTENSITY = 0.85;

/* ---- Planets ---- */
export const PLANET_SPIN = 0.05; // rad/s
export const PLANET_AMBIENT = 0.04;
export const PLANET_RIM = 0.9; // fresnel rim strength
export const ATMO_SCALE = 1.16; // glow shell radius / planet radius
export const ATMO_INTENSITY = 0.75;
export const RING_INNER = 1.45; // x planet radius
export const RING_OUTER = 2.4;
export const RING_TILT = 0.42;
export const RING_OPACITY = 0.85;
export const MOON_MIN_RADIUS = 1.25; // planets with radius >= this get a moon (high tier)
export const MOON_ORBIT = 3.0; // x planet radius
export const MOON_SIZE = 0.2; // x planet radius
export const MOON_SPEED = 0.16; // rad/s

/* ---- Stars ---- */
export const STARS_HIGH = 6000;
export const STARS_LOW = 1500;
export const STAR_RADIUS = 800;
export const STAR_SIZE_MIN = 1.1; // px at DPR 1
export const STAR_SIZE_MAX = 3.4;
export const STAR_LAYER_PARALLAX = 0.15; // per depth layer (3 layers)
export const STAR_TWINKLE = 0.25; // 0..1 amplitude; speed stays below 0.7 Hz

/* ---- Nebula ---- */
export const NEBULA_PINK = '#e79ce1';
export const NEBULA_BLUE = '#77c5f9';
export const NEBULA_PURPLE = '#7c5cc4';
export const NEBULA_INTENSITY = 0.31;
export const NEBULA_TEXT_SHADE = 0.75; // 0..1: how much the nebula darkens on the text side of the screen
export const NEBULA_VIGNETTE = 0.3; // 0..1: nebula darkening at the screen corners
export const NEBULA_DRIFT = 0.0016; // turns/s (high tier only)
export const NEBULA_SIZE_HIGH: readonly [number, number] = [1024, 512];
export const NEBULA_SIZE_LOW: readonly [number, number] = [512, 256];

/* ---- Dust + pointer (E2) ---- */
export const DUST_HIGH = 900;
export const DUST_LOW = 280;
export const DUST_BOX = 60; // edge of the wrap box around the camera
export const DUST_OPACITY = 0.55;
export const POINTER_PARALLAX_POS = 0.35; // world units at the screen edge
export const POINTER_PARALLAX_ROT = 0.025; // rad at the screen edge
export const POINTER_DAMPING = 3.5; // 1/s
export const POINTER_REPEL = 0.07; // NDC units
export const POINTER_FALLOFF = 9; // higher = smaller pointer zone
export const POINTER_GLOW = 0.07; // sky glow below the pointer
export const POINTER_GLOW_COLOR = '#e79ce1';

/* ---- Warp (E7, high tier only) ---- */
export const WARP_SCROLL_START = 1.4; // viewport heights per second
export const WARP_SCROLL_FULL = 5.0;
export const WARP_TRAVEL_START = 0.7; // stations per second (anchor jumps)
export const WARP_TRAVEL_FULL = 2.2;
export const WARP_RISE = 6; // 1/s
export const WARP_FALL = 4.5; // 1/s
export const WARP_STRETCH = 9; // maximum star length factor
export const WARP_FOV_KICK = 7; // degrees

/* ---- Auto-downgrade ---- */
export const FPS_WINDOW_S = 1; // length of one measurement
export const FPS_WARMUP_WINDOWS = 2; // first windows are not judged (shader compile)
export const FPS_HIGH_MIN = 30;
export const FPS_HIGH_WINDOWS = 2; // consecutive slow windows before high -> low
export const FPS_LOW_MIN = 24;
export const FPS_LOW_WINDOWS = 3; // 3 s below the limit on low -> stop the scene
