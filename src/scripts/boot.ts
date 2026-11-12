/*
 * boot.ts — the one script entry of the page (BaseLayout imports it).
 *
 * Now (T1 stub): wires each `[data-motion-toggle]` button.
 *   click            -> setMotion(!motionOn())
 *   `motionchange`   -> `aria-pressed` follows the state (pressed = motion on).
 *   The visible label follows `html[data-motion]` through CSS (MotionToggle.astro).
 * Later (orchestrator): init the ALWAYS modules and init / dispose the MOTION
 * modules here (SHARED.md section 4).
 */
import { motionOn, onMotionChange, setMotion } from './motion.ts';

const toggles = document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]');

const syncToggles = (on: boolean): void => {
  toggles.forEach((toggle) => {
    toggle.setAttribute('aria-pressed', String(on));
  });
};

toggles.forEach((toggle) => {
  toggle.hidden = false;
  toggle.addEventListener('click', () => setMotion(!motionOn()));
});

syncToggles(motionOn());
onMotionChange(syncToggles);
