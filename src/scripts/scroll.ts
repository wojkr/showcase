/*
 * scroll.ts — scroll-linked effects (group: MOTION). Owner: T6.
 *
 * boot.ts: call `kinetic.init()` first, then `scroll.init()` (this module runs
 * the final `ScrollTrigger.refresh()`). Dispose in the reverse order.
 *
 * What `init()` makes:
 *   E12  Launch intro of the hero (once per page load; skipped with a hash,
 *        with scrollY > 0, or when the script starts late).
 *   E4   Stage reveal: the text panel, its children, and the media "power on".
 *   E5   Pinned stage (>= 64em wide and >= 700px high): `.stage__inner` is
 *        pinned for PIN.length x viewport height; a scrubbed timeline flattens
 *        the media and lights the stack pills.
 *        Hero fade-out with scrub, pilot reveal, scroll progress bar.
 *
 * Rules that this file keeps:
 *   - Native scroll only. No wheel or key handler, no `preventDefault`.
 *   - Hidden start states come from GSAP (inline), never from CSS. `opacity`
 *     only (no `visibility`), so each link stays in the Tab order.
 *   - Focus inside a stage or the pilot jumps its reveal to the end. CSS
 *     (`:focus-within` in effects.css) is the second safety net.
 *   - A section that is already at or above the reveal line at `init()` (hash
 *     load, restored scroll) starts in its end state.
 *   - `.stage__media` gets no inline `transform` (the tilt script owns it).
 *     Scale, tilt, and shift use the CSS variables `--fx-scale`, `--fx-ry`,
 *     `--fx-y` (see effects.css: `scale`, `rotate`, `translate` properties).
 *   - Refresh order: `refreshPriority` = 100 hero, -(index * 10) pin of a stage,
 *     -(index * 10) - 5 other triggers of that stage (kinetic.ts uses the same
 *     numbers), then the pilot, then the progress bar.
 *
 * `dispose()` reverts every tween, ScrollTrigger, pin spacer, inline style,
 * class, listener, and node, and keeps the section at the top of the viewport
 * in place.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export type Dispose = () => void;

/* ---------------------------------------------------------------------------
   Tunable constants (seconds, pixels, viewport fractions)
   --------------------------------------------------------------------------- */

/** Media queries. Keep them equal to the layout breakpoint `lg` = 64em. */
const QUERY = {
  desk: '(min-width: 64em)',
  mobile: '(max-width: 63.99em)',
  pin: '(min-width: 64em) and (min-height: 700px)',
} as const;

/** E12 launch intro. The last tween ends at about delay + 1.15 s. */
const INTRO = {
  delay: 0.05, // wait before the first element
  maxStartMs: 3000, // skip the intro if init() runs later than this after navigation start
  shift: 26, // px, travel of each element
  duration: 0.55,
  at: { kicker: 0, lead: 0.3, cta: 0.42, nav: 0.5, hint: 0.6 }, // start time of each element
  ctaBlur: 8, // px, the CTA fades in from a blur (no transform: the magnetic script owns it)
};

/** Hero -> first stage: the hero content fades and lifts while the hero leaves. */
const HERO_OUT = {
  start: 'bottom 70%', // hero bottom at 70 % of the viewport: the fade starts
  end: 'bottom 8%',
  lift: -90, // px
  scale: 0.96,
};

/** E4 stage reveal. `line`: the stage top must pass this fraction of the viewport height. */
const REVEAL = {
  line: 0.8,
  // Desktop.
  bodyShift: 56, // px, the panel slides in from its outer side
  bodyDuration: 0.7,
  kidShift: 22, // px
  kidDuration: 0.5,
  kidStagger: 0.06,
  kidsAt: 0.12,
  mediaAt: 0.05,
  mediaLine: 0.26, // s, the bright line grows
  mediaOpen: 0.55, // s, the line opens to the full screen
  mediaFlash: 2.6, // brightness at power-on
  // Desktop without a pin (viewport lower than 700px): the tilt runs in the reveal.
  flatDuration: 0.9,
  pillAt: 0.5,
  pillStagger: 0.07,
  // Mobile (simple, short).
  mobileShift: 24,
  mobileKidShift: 10,
  mobileDuration: 0.45,
  mobileKidStagger: 0.04,
};

/** E5 pinned stage. */
const PIN = {
  length: 0.55, // pin distance = length x viewport height
  scrub: 0.6, // s, catch-up time of the scrubbed timeline
  mediaScale: 0.9, // start scale of the media
  mediaTilt: 10, // deg, start rotateY of the media (sign follows data-side)
  margin: 16, // px, free space above a panel that is higher than the viewport
  flatStart: 'top 75%', // stage top here: the media starts to go flat (before the pin)
  flatEnd: 'top 30%', // stage top here: the media is flat (scale 1, rotateY 0)
  litBy: 0.35, // fraction of the pin distance at which all pills are lit; then hold
};

/** Pilot section reveal. */
const PILOT = {
  line: 0.75,
  panelScale: 0.94,
  panelBlur: 14, // px (desktop only)
  photoScale: 0.7,
  photoTurn: -18, // deg
  itemShift: 20,
  itemStagger: 0.08,
};

/** Scroll progress bar: catch-up time of the scrub. */
const PROGRESS_SCRUB = 0.3;

/* CRT "power on" clip shapes. The open shape is larger than the box, so the
   glow and the planet are not cut at the end. */
const CLIP_DOT = 'inset(49.6% 50% 49.6% 50%)';
const CLIP_LINE = 'inset(49.6% 0% 49.6% 0%)';
const CLIP_OPEN = 'inset(-60% -45% -25% -45%)';

const FX_VARS = ['--fx-scale', '--fx-ry', '--fx-y', '--fx-lit'] as const;

/* --------------------------------------------------------------------------- */

/** True after the first `init()`: the intro plays one time per page load. */
let introDone = false;

interface Anchor {
  el: HTMLElement;
  top: number;
}

interface Modes {
  desk: boolean;
  mobile: boolean;
  pin: boolean;
}

const q = <T extends HTMLElement>(root: ParentNode, selector: string): T | null => root.querySelector<T>(selector);

/** The last section whose top is at or above `limit` (px from the viewport top). */
function readAnchor(sections: HTMLElement[], limit: number): Anchor | null {
  if (window.scrollY <= 0) return null;
  let found: Anchor | null = null;
  for (const el of sections) {
    const top = el.getBoundingClientRect().top;
    if (top > limit + 1) break;
    found = { el, top };
  }
  return found;
}

/** Scrolls (no animation) so that the anchor section is where it was. */
function restoreAnchor(anchor: Anchor | null): void {
  if (!anchor || !anchor.el.isConnected) return;
  const delta = anchor.el.getBoundingClientRect().top - anchor.top;
  if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' });
}

export function init(): Dispose {
  gsap.registerPlugin(ScrollTrigger);

  const hero = q<HTMLElement>(document, '[data-section="hero"]');
  const pilot = q<HTMLElement>(document, '[data-section="pilot"]');
  const stages = Array.from(document.querySelectorAll<HTMLElement>('[data-stage]'));
  const sections = Array.from(document.querySelectorAll<HTMLElement>('main > section'));
  const headerHeight = q<HTMLElement>(document, '.site-header')?.offsetHeight ?? 64;

  let alive = true;
  const cleanups: Array<() => void> = [];
  /** Classes that this module may add: [element, class]. Removed in dispose. */
  const classed: Array<[Element, string]> = [];

  // The pin spacers move the content: keep the current section in place.
  const anchor = readAnchor(sections, headerHeight);

  const skipIntro = introDone || window.location.hash.length > 1 || window.scrollY > 0 || performance.now() > INTRO.maxStartMs;
  introDone = true;

  /* --- Progress bar node (decorative) --- */
  const progress = document.createElement('div');
  progress.className = 'fx-progress';
  progress.setAttribute('aria-hidden', 'true');
  const progressBar = document.createElement('span');
  progressBar.className = 'fx-progress__bar';
  progress.append(progressBar);
  document.body.append(progress);

  /* -------------------------------------------------------------------------
     Effects that do not depend on the breakpoint
     ------------------------------------------------------------------------- */
  const ctx = gsap.context(() => {
    gsap.fromTo(
      progressBar,
      { scaleX: 0 },
      { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: PROGRESS_SCRUB, refreshPriority: -5000 } },
    );

    if (!hero) return;
    const inner = q<HTMLElement>(hero, '.hero__inner');

    // E12 launch intro. kinetic.ts animates the letters of the title.
    if (!skipIntro) {
      const tl = gsap.timeline({ delay: INTRO.delay });
      const rise = (selector: string, at: number): void => {
        const el = q<HTMLElement>(hero, selector);
        if (!el) return;
        tl.from(el, { opacity: 0, y: INTRO.shift, duration: INTRO.duration, ease: 'power3.out', clearProps: 'opacity,transform' }, at);
      };
      rise('.hero__kicker', INTRO.at.kicker);
      rise('.hero__lead', INTRO.at.lead);
      rise('.hero__nav', INTRO.at.nav);
      rise('.hero__hint', INTRO.at.hint);
      const cta = q<HTMLElement>(hero, '.hero__cta');
      if (cta) {
        tl.from(
          cta,
          { opacity: 0, filter: `blur(${INTRO.ctaBlur}px)`, duration: INTRO.duration, ease: 'power2.out', clearProps: 'opacity,filter' },
          INTRO.at.cta,
        );
      }
    }

    // Hero -> first stage. `:focus-within` in effects.css cancels the fade.
    if (inner) {
      const out = gsap.timeline({
        defaults: { ease: 'none' },
        scrollTrigger: { trigger: hero, start: HERO_OUT.start, end: HERO_OUT.end, scrub: true, refreshPriority: 100 },
      });
      out.fromTo(inner, { y: 0, scale: 1 }, { y: HERO_OUT.lift, scale: HERO_OUT.scale, duration: 1 }, 0);
      out.fromTo(inner, { opacity: 1 }, { opacity: 0, duration: 1, ease: 'power2.in' }, 0);
    }

    // The CSS loop of the scroll hint runs only while the hero is on screen.
    ScrollTrigger.create({
      trigger: hero,
      start: 'top bottom',
      end: 'bottom top',
      refreshPriority: 100,
      onToggle: (self) => hero.classList.toggle('fx-live', self.isActive),
    });
    classed.push([hero, 'fx-live']);
  });

  /* -------------------------------------------------------------------------
     Effects that depend on the breakpoint (reverted and built again on change)
     ------------------------------------------------------------------------- */
  const mm = gsap.matchMedia();

  mm.add(QUERY, (context) => {
    const modes = (context.conditions ?? {}) as unknown as Modes;
    const viewport = window.innerHeight;
    const off: Array<() => void> = [];

    /** Plays `tl` when `section` passes the line; reverses it on the way back. */
    const reveal = (section: HTMLElement, tl: gsap.core.Timeline, line: number, priority: number, onBack?: () => void): void => {
      ScrollTrigger.create({
        trigger: section,
        start: `top ${line * 100}%`,
        refreshPriority: priority,
        onEnter: () => tl.play(),
        onLeaveBack: () => {
          onBack?.();
          tl.reverse();
        },
      });
      // Keyboard: content must never be invisible while it has focus.
      const onFocus = (): void => {
        tl.progress(1);
      };
      section.addEventListener('focusin', onFocus);
      off.push(() => section.removeEventListener('focusin', onFocus));
    };

    // Read the layout first (one pass), then write.
    const stageTops = stages.map((stage) => stage.getBoundingClientRect().top);
    const pilotTop = pilot ? pilot.getBoundingClientRect().top : Number.POSITIVE_INFINITY;

    stages.forEach((stage, index) => {
      const inner = q<HTMLElement>(stage, '.stage__inner');
      const body = q<HTMLElement>(stage, '.stage__body');
      const media = q<HTMLElement>(stage, '.stage__media');
      if (!inner || !body || !media) return;

      const kids = Array.from(body.children);
      const pills = Array.from(stage.querySelectorAll<HTMLElement>('.stage__stack > li'));
      const mediaLeft = stage.dataset.side === 'left';
      const tilt = (mediaLeft ? 1 : -1) * PIN.mediaTilt;
      const priority = -(index * 10);

      const tl = gsap.timeline({ paused: true });

      if (modes.desk) {
        tl.fromTo(
          body,
          { opacity: 0, x: (mediaLeft ? 1 : -1) * REVEAL.bodyShift },
          { opacity: 1, x: 0, duration: REVEAL.bodyDuration, ease: 'expo.out' },
          0,
        );
        tl.fromTo(
          kids,
          { opacity: 0, y: REVEAL.kidShift },
          { opacity: 1, y: 0, duration: REVEAL.kidDuration, ease: 'power3.out', stagger: REVEAL.kidStagger },
          REVEAL.kidsAt,
        );
        // Screen powers on: a bright line grows, then opens.
        tl.fromTo(
          media,
          { opacity: 0, clipPath: CLIP_DOT, filter: `brightness(${REVEAL.mediaFlash})` },
          { opacity: 1, clipPath: CLIP_LINE, filter: `brightness(${REVEAL.mediaFlash})`, duration: REVEAL.mediaLine, ease: 'power2.out' },
          REVEAL.mediaAt,
        );
        tl.to(media, { clipPath: CLIP_OPEN, filter: 'brightness(1)', duration: REVEAL.mediaOpen, ease: 'expo.out' }, '>');
        tl.call(
          () => {
            if (tl.reversed()) return;
            gsap.set(media, { clearProps: 'clipPath,filter' }); // gives the glow (box-shadow) back
            media.classList.add('fx-pulse'); // one accent glow pulse (effects.css)
          },
          undefined,
          '>',
        );
        if (!modes.pin) {
          tl.fromTo(
            media,
            { '--fx-scale': PIN.mediaScale, '--fx-ry': tilt },
            { '--fx-scale': 1, '--fx-ry': 0, duration: REVEAL.flatDuration, ease: 'expo.out' },
            REVEAL.mediaAt,
          );
        }
      } else {
        tl.fromTo(
          media,
          { opacity: 0, '--fx-y': REVEAL.mobileShift },
          { opacity: 1, '--fx-y': 0, duration: REVEAL.mobileDuration, ease: 'power2.out' },
          0,
        );
        tl.fromTo(
          body,
          { opacity: 0, y: REVEAL.mobileShift },
          { opacity: 1, y: 0, duration: REVEAL.mobileDuration, ease: 'power2.out' },
          0.08,
        );
        tl.fromTo(
          kids,
          { opacity: 0, y: REVEAL.mobileKidShift },
          { opacity: 1, y: 0, duration: REVEAL.mobileDuration, ease: 'power2.out', stagger: REVEAL.mobileKidStagger },
          0.14,
        );
      }

      if (!modes.pin && pills.length > 0) {
        tl.fromTo(pills, { '--fx-lit': 0 }, { '--fx-lit': 1, duration: 0.3, ease: 'power1.out', stagger: REVEAL.pillStagger }, REVEAL.pillAt);
      }

      classed.push([media, 'fx-pulse']);
      // Already at or above the line (hash load, restored scroll): end state now.
      if ((stageTops[index] ?? Number.POSITIVE_INFINITY) < viewport * REVEAL.line) tl.progress(1);
      reveal(stage, tl, REVEAL.line, priority - 5, () => media.classList.remove('fx-pulse'));

      // E5: pin + scrubbed timeline.
      if (modes.pin) {
        // Full-width wrapper: the pinned (fixed) box is the wrapper, so the
        // centered `.stage__inner` keeps its width and auto margins inside it.
        const wrap = document.createElement('div');
        wrap.className = 'fx-pin';
        inner.replaceWith(wrap);
        wrap.append(inner);
        off.push(() => {
          if (wrap.isConnected) wrap.replaceWith(inner);
        });

        // While the stage comes in: the media goes flat. It is flat before the
        // panel reaches its reading position (and before an anchor landing).
        gsap.fromTo(
          media,
          { '--fx-scale': PIN.mediaScale, '--fx-ry': tilt },
          {
            '--fx-scale': 1,
            '--fx-ry': 0,
            ease: 'none',
            scrollTrigger: {
              trigger: stage,
              start: PIN.flatStart,
              end: PIN.flatEnd,
              scrub: PIN.scrub,
              invalidateOnRefresh: true,
              refreshPriority: priority - 5,
            },
          },
        );

        // During the pin: the pills light in the first part, then all holds.
        const scrubbed = gsap.timeline({ defaults: { ease: 'none' } });
        if (pills.length > 0) {
          const step = (PIN.litBy - 0.1) / pills.length;
          scrubbed.fromTo(pills, { '--fx-lit': 0 }, { '--fx-lit': 1, duration: 0.1, stagger: step }, 0);
        }
        scrubbed.to({}, { duration: 1 - PIN.litBy }, PIN.litBy);

        ScrollTrigger.create({
          trigger: wrap,
          pin: wrap,
          // Centered below the header; a panel higher than the viewport pins at its top.
          start: () =>
            wrap.offsetHeight > window.innerHeight - headerHeight - 2 * PIN.margin
              ? `top top+=${headerHeight + PIN.margin}`
              : `center center+=${headerHeight / 2}`,
          end: () => `+=${Math.round(window.innerHeight * PIN.length)}`,
          scrub: PIN.scrub,
          animation: scrubbed,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          refreshPriority: priority,
        });
      }
    });

    /* --- Pilot --- */
    if (pilot) {
      const panel = q<HTMLElement>(pilot, '.pilot__inner');
      const photo = q<HTMLElement>(pilot, '.pilot__photo');
      const items = Array.from(pilot.querySelectorAll<HTMLElement>('.pilot__title, .pilot__text, .pilot__links'));
      const priority = -(stages.length * 10) - 5;

      if (panel) {
        const tl = gsap.timeline({ paused: true });
        if (modes.desk) {
          tl.fromTo(
            panel,
            { opacity: 0, scale: PILOT.panelScale, filter: `blur(${PILOT.panelBlur}px)` },
            { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.8, ease: 'expo.out' },
            0,
          );
          tl.call(
            () => {
              if (!tl.reversed()) gsap.set(panel, { clearProps: 'filter' });
            },
            undefined,
            '>',
          );
        } else {
          tl.fromTo(panel, { opacity: 0, y: REVEAL.mobileShift }, { opacity: 1, y: 0, duration: REVEAL.mobileDuration, ease: 'power2.out' }, 0);
        }
        if (photo) {
          tl.fromTo(
            photo,
            { opacity: 0, scale: modes.desk ? PILOT.photoScale : 0.9, rotation: modes.desk ? PILOT.photoTurn : 0 },
            { opacity: 1, scale: 1, rotation: 0, duration: modes.desk ? 0.9 : REVEAL.mobileDuration, ease: modes.desk ? 'back.out(1.4)' : 'power2.out' },
            0.15,
          );
        }
        if (items.length > 0) {
          tl.fromTo(
            items,
            { opacity: 0, y: modes.desk ? PILOT.itemShift : REVEAL.mobileKidShift },
            { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out', stagger: PILOT.itemStagger },
            0.25,
          );
        }
        if (pilotTop < viewport * PILOT.line) tl.progress(1);
        reveal(pilot, tl, PILOT.line, priority);
      }

      // The ring loop (effects.css) runs only while the pilot is on screen.
      if (photo) {
        ScrollTrigger.create({
          trigger: pilot,
          start: 'top bottom',
          end: 'bottom top',
          refreshPriority: priority,
          onToggle: (self) => photo.classList.toggle('fx-live', self.isActive),
        });
        classed.push([photo, 'fx-live']);
      }
    }

    return () => {
      off.forEach((fn) => fn());
    };
  });

  /* --- First layout pass: sort by priority, measure, keep the section in place --- */
  ScrollTrigger.refresh();
  restoreAnchor(anchor);
  ScrollTrigger.update();

  /* --- Fonts and images change the layout: measure again --- */
  const refresh = (): void => {
    if (alive) ScrollTrigger.refresh();
  };
  if ('fonts' in document) void document.fonts.ready.then(refresh);
  if (document.readyState !== 'complete') {
    window.addEventListener('load', refresh, { once: true });
    cleanups.push(() => window.removeEventListener('load', refresh));
  }

  return () => {
    if (!alive) return;
    alive = false;
    const before = readAnchor(sections, headerHeight);

    mm.revert();
    ctx.revert();
    cleanups.forEach((fn) => fn());
    progress.remove();

    for (const [el, name] of classed) el.classList.remove(name);
    document.querySelectorAll<HTMLElement>('.stage__media, .stage__stack > li').forEach((el) => {
      for (const name of FX_VARS) el.style.removeProperty(name);
      if (el.getAttribute('style') === '') el.removeAttribute('style');
    });

    restoreAnchor(before);
  };
}
