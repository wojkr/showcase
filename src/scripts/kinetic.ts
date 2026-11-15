/*
 * kinetic.ts — kinetic typography (group: MOTION). Owner: T6.
 *
 * boot.ts: call `kinetic.init()` before `scroll.init()`; dispose in the
 * reverse order. This module does not call `ScrollTrigger.refresh()`.
 *
 * What `init()` makes:
 *   - Each `[data-kinetic]` heading is split into words and letters
 *     (`span.kinetic__word > span.kinetic__char`, all `aria-hidden="true"`).
 *     The heading gets `aria-label` = the full text and the class `kinetic`.
 *   - Hero title: letters fly in (3D turn, stagger, short character scramble),
 *     then a glow sweep (once per page load; skipped with a hash, with
 *     scrollY > 0, or when the script starts late). With a mouse: the title
 *     tilts a little toward the pointer, and the sweep plays again on hover.
 *   - Stage titles: letters reveal when the stage passes the reveal line
 *     (ScrollTrigger; reverse on the way back), then a sweep in the stage accent.
 *   - Ghost index: a decorative outlined "01"…"05" per stage (`span.fx-ghost`,
 *     `aria-hidden`) that drifts at a different scroll speed.
 *
 * Start-up is phased: task 1 = hero title; then one stage per task. With a
 * hash or scrollY > 0 all is built in one task.
 *
 * `dispose()` cancels the steps that are left, puts back the original child nodes and `aria-label` of each
 * heading, removes the ghosts, the listeners, the tweens, and the ScrollTriggers.
 *
 * `refreshPriority` numbers equal the ones in scroll.ts (see the header there).
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export type Dispose = () => void;

/* ---------------------------------------------------------------------------
   Tunable constants (seconds, pixels, degrees)
   --------------------------------------------------------------------------- */

/** Layout breakpoint `lg`: 3D letter turns only at and above it. */
const QUERY_DESK = '(min-width: 64em)';
/** Pointer effects need a mouse. */
const QUERY_MOUSE = '(hover: hover) and (pointer: fine)';

/** Hero title intro. Last letter ends at about delay + letters x stagger + duration. */
const HERO = {
  delay: 0.05,
  maxStartMs: 3000, // skip if init() runs later than this after navigation start (equal to scroll.ts)
  duration: 0.6, // one letter
  stagger: 0.025, // between letters
  rise: 120, // yPercent start
  rotateX: -95, // deg
  rotateZ: 8, // deg
  perspective: 600, // px
  scrambleSteps: 3, // random glyphs per letter before the real one
  scramble: 0.24, // s per letter
  sweepAt: 0.5, // s, start of the glow sweep
  tilt: 5, // deg, largest pointer tilt of the title
  tiltPerspective: 900, // px
};

/** Stage title reveal. `line` must equal REVEAL.line in scroll.ts. */
const TITLE = {
  line: 0.8,
  delay: 0.18, // after the panel starts to come in
  duration: 0.5,
  stagger: 0.025,
  rise: 70, // yPercent start
  rotateX: -80, // deg (desktop only)
  perspective: 500,
};

/** Ghost index number: drift in percent of its own height, over the stage pass. */
const GHOST = {
  from: 40,
  to: -40,
  scrub: 0.5,
};

const GLYPHS = 'ABCDEFGHKLMNPRSTUVXYZ0123456789#/<>*+';

/* --------------------------------------------------------------------------- */

/** True after the first `init()`: the hero intro plays one time per page load. */
let introDone = false;

interface Split {
  el: HTMLElement;
  nodes: ChildNode[];
  ariaLabel: string | null;
  chars: HTMLElement[];
}

/** Small letter splitter: words (no wrap inside) and letters, both inline-block (effects.css). */
function split(el: HTMLElement): Split | null {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const nodes = Array.from(el.childNodes);
  const ariaLabel = el.getAttribute('aria-label');
  const chars: HTMLElement[] = [];
  const fragment = document.createDocumentFragment();

  text.split(' ').forEach((word, wordIndex) => {
    if (wordIndex > 0) fragment.append(' ');
    const wordEl = document.createElement('span');
    wordEl.className = 'kinetic__word';
    wordEl.setAttribute('aria-hidden', 'true');
    for (const letter of Array.from(word)) {
      const charEl = document.createElement('span');
      charEl.className = 'kinetic__char';
      charEl.textContent = letter;
      charEl.style.setProperty('--i', String(chars.length)); // sweep delay step (effects.css)
      chars.push(charEl);
      wordEl.append(charEl);
    }
    fragment.append(wordEl);
  });

  el.replaceChildren(fragment);
  el.setAttribute('aria-label', text);
  el.classList.add('kinetic');
  return { el, nodes, ariaLabel, chars };
}

function restore(item: Split): void {
  item.el.replaceChildren(...item.nodes);
  if (item.ariaLabel === null) item.el.removeAttribute('aria-label');
  else item.el.setAttribute('aria-label', item.ariaLabel);
  item.el.classList.remove('kinetic', 'kinetic--sweep');
  if (item.el.getAttribute('class') === '') item.el.removeAttribute('class');
}

const randomGlyph = (): string => GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));

export function init(): Dispose {
  gsap.registerPlugin(ScrollTrigger);

  const desk = window.matchMedia(QUERY_DESK).matches;
  const mouse = window.matchMedia(QUERY_MOUSE).matches;
  const viewport = window.innerHeight;
  const stages = Array.from(document.querySelectorAll<HTMLElement>('[data-stage]'));
  const hero = document.querySelector<HTMLElement>('[data-section="hero"]');

  const skipIntro = introDone || window.location.hash.length > 1 || window.scrollY > 0 || performance.now() > HERO.maxStartMs;
  introDone = true;

  // Hash load or restored scroll: build all in one task (equal to scroll.ts).
  const eagerStart = window.location.hash.length > 1 || window.scrollY > 0;
  let alive = true;
  let stepTimer: number | undefined;

  const splits: Split[] = [];
  const ghosts: HTMLElement[] = [];
  const cleanups: Array<() => void> = [];

  const listen = <K extends keyof HTMLElementEventMap>(
    el: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void => {
    el.addEventListener(type, handler, options);
    cleanups.push(() => el.removeEventListener(type, handler, options));
  };

  /** Plays the CSS glow sweep one time; the class goes away after the last letter. */
  const sweep = (item: Split): void => {
    item.el.classList.add('kinetic--sweep');
  };
  const watchSweep = (item: Split): void => {
    const last = item.chars[item.chars.length - 1];
    listen(item.el, 'animationend', (event) => {
      if (event.target === last) item.el.classList.remove('kinetic--sweep');
    });
  };

  const ctx = gsap.context(() => {
    /* --- Hero title --- */
    const heroTitle = hero?.querySelector<HTMLElement>('[data-kinetic]') ?? null;
    const heroSplit = heroTitle ? split(heroTitle) : null;
    if (heroTitle && heroSplit) {
      splits.push(heroSplit);
      watchSweep(heroSplit);
      const { chars } = heroSplit;
      let ready = skipIntro; // true when the intro is over: pointer effects may run

      if (!skipIntro) {
        // Scramble: the random glyph is painted by `::after` from `data-glyph`
        // (effects.css). The real letter keeps its box, so there is no layout
        // read, no layout write, and no line move.
        const tl = gsap.timeline({
          delay: HERO.delay,
          onComplete: () => {
            chars.forEach((char) => char.removeAttribute('data-glyph'));
            gsap.set(chars, { clearProps: 'transform,opacity' });
            ready = true;
          },
        });
        tl.fromTo(
          chars,
          {
            opacity: 0,
            yPercent: HERO.rise,
            rotationX: HERO.rotateX,
            rotationZ: HERO.rotateZ,
            transformPerspective: HERO.perspective,
            transformOrigin: '50% 100%',
          },
          { opacity: 1, yPercent: 0, rotationX: 0, rotationZ: 0, duration: HERO.duration, ease: 'back.out(1.5)', stagger: HERO.stagger },
          0,
        );
        chars.forEach((char, i) => {
          const state = { step: 0 };
          let shown = -1;
          tl.to(
            state,
            {
              step: HERO.scrambleSteps,
              duration: HERO.scramble,
              ease: 'none',
              onUpdate: () => {
                const step = Math.floor(state.step);
                if (step === shown) return;
                shown = step;
                if (step >= HERO.scrambleSteps) char.removeAttribute('data-glyph');
                else char.setAttribute('data-glyph', randomGlyph());
              },
              onComplete: () => {
                char.removeAttribute('data-glyph');
              },
            },
            i * HERO.stagger,
          );
        });
        tl.call(() => sweep(heroSplit), undefined, HERO.sweepAt);
      }

      // Pointer: a small tilt of the whole title, and the sweep again on hover.
      if (mouse && hero) {
        gsap.set(heroTitle, { transformPerspective: HERO.tiltPerspective });
        const turnY = gsap.quickTo(heroTitle, 'rotationY', { duration: 0.6, ease: 'power3.out' });
        const turnX = gsap.quickTo(heroTitle, 'rotationX', { duration: 0.6, ease: 'power3.out' });
        listen(
          hero,
          'pointermove',
          (event) => {
            if (!ready || event.pointerType !== 'mouse') return;
            turnY((event.clientX / window.innerWidth - 0.5) * 2 * HERO.tilt);
            turnX(-(event.clientY / window.innerHeight - 0.5) * 2 * HERO.tilt);
          },
          { passive: true },
        );
        listen(hero, 'pointerleave', () => {
          turnY(0);
          turnX(0);
        });
        listen(heroTitle, 'pointerenter', () => {
          if (ready) sweep(heroSplit);
        });
      }
    }

  });

  /* --- One stage (title letters + ghost index) = one start-up step --- */
  const buildStage = (stage: HTMLElement, index: number): void => {
    {
      const priority = -(index * 10) - 5;
      const stageTop = stage.getBoundingClientRect().top; // the one layout read of this step

      const title = stage.querySelector<HTMLElement>('[data-kinetic]');
      const item = title ? split(title) : null;
      if (item) {
        splits.push(item);
        watchSweep(item);
        const tl = gsap.timeline({ paused: true });
        tl.fromTo(
          item.chars,
          desk
            ? { opacity: 0, yPercent: TITLE.rise, rotationX: TITLE.rotateX, transformPerspective: TITLE.perspective, transformOrigin: '50% 100%' }
            : { opacity: 0, yPercent: TITLE.rise / 2 },
          desk
            ? { opacity: 1, yPercent: 0, rotationX: 0, duration: TITLE.duration, ease: 'power3.out', stagger: TITLE.stagger }
            : { opacity: 1, yPercent: 0, duration: TITLE.duration * 0.7, ease: 'power2.out', stagger: TITLE.stagger * 0.6 },
          TITLE.delay,
        );
        tl.call(
          () => {
            if (!tl.reversed()) sweep(item);
          },
          undefined,
          '>-0.2',
        );

        // Already at or above the line (hash load, restored scroll): end state now.
        if (stageTop < viewport * TITLE.line) tl.progress(1, true);

        ScrollTrigger.create({
          trigger: stage,
          start: `top ${TITLE.line * 100}%`,
          refreshPriority: priority,
          onEnter: () => tl.play(),
          onLeaveBack: () => {
            item.el.classList.remove('kinetic--sweep');
            tl.reverse();
          },
        });
        // Keyboard and hash focus: the title must be readable at once.
        listen(stage, 'focusin', () => {
          tl.progress(1, true);
        });
      }

      // Ghost index: after the legacy anchor, before `.stage__inner`.
      // A direct child of the stage (never inside the pin wrapper of scroll.ts).
      const legacy = stage.querySelector<HTMLElement>(':scope > .legacy-anchor');
      {
        const ghost = document.createElement('span');
        ghost.className = 'fx-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.textContent = String(index + 1).padStart(2, '0');
        stage.insertBefore(ghost, legacy ? legacy.nextSibling : stage.firstChild);
        ghosts.push(ghost);
        gsap.fromTo(
          ghost,
          { yPercent: GHOST.from },
          {
            yPercent: GHOST.to,
            ease: 'none',
            scrollTrigger: { trigger: stage, start: 'top bottom', end: 'bottom top', scrub: GHOST.scrub, refreshPriority: priority },
          },
        );
      }
    }
  };

  if (eagerStart) {
    ctx.add(() => stages.forEach(buildStage));
  } else {
    // Phased start-up: one stage per task. scroll.ts runs the final refresh.
    let next = 0;
    const run = (): void => {
      stepTimer = undefined;
      if (!alive) return;
      const stage = stages[next];
      const index = next;
      next += 1;
      if (stage) ctx.add(() => buildStage(stage, index)); // records the tweens and triggers in the context
      if (next < stages.length) stepTimer = window.setTimeout(run, 0);
    };
    if (stages.length > 0) stepTimer = window.setTimeout(run, 0);
  }

  return () => {
    if (!alive) return;
    alive = false;
    if (stepTimer !== undefined) window.clearTimeout(stepTimer);
    ctx.revert();
    cleanups.forEach((fn) => fn());
    ghosts.forEach((ghost) => ghost.remove());
    splits.forEach(restore);
    document.querySelectorAll<HTMLElement>('[data-kinetic]').forEach((el) => {
      if (el.getAttribute('style') === '') el.removeAttribute('style');
    });
  };
}
