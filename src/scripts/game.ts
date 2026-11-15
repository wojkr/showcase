/*
 * game.ts — effect E11: a hidden block-breaker mini game (easter egg).
 *
 * Group: MOTION (boot.ts loads it lazily; init when motion goes on, dispose when off).
 * Open: the `[data-game-open]` button (init removes its `hidden`), or the keys
 * Up Up Down Down Left Right Left Right.
 * UI: a native <dialog class="game"> made here (focus trap and Esc are native).
 * Controls: pointer on the canvas, Left/Right or A/D, Space = start/pause,
 * on-screen hold buttons for touch. The game never starts by itself.
 * dispose() closes the game, removes the dialog and all listeners, and hides the button.
 */

export type Dispose = () => void;
type State = 'ready' | 'run' | 'pause' | 'over';

const W = 480;
const H = 360;
const COLORS = ['#77C5F9', '#F6C177', '#FF8FB1', '#7FE0A8', '#FFB05C'];
const COLS = 8;
const GAP = 6;
const BW = (W - GAP * (COLS + 1)) / COLS;
const BH = 14;
const TOP = 36;
const PW = 76; // paddle
const PH = 10;
const PY = H - 24;
const PSPEED = 420;
const R = 5; // ball radius
const SPEED = 210;
const SPEED_MAX = 400;
const ACCEL = 3; // px/s more, each second
const MAX_ANGLE = 1.05; // rad from vertical, at the paddle edge
const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight'];
const LABEL: Record<State, string> = { ready: 'Start', run: 'Pause', pause: 'Resume', over: 'Play again' };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export function init(): Dispose {
  const dialog = document.createElement('dialog');
  dialog.className = 'game';
  dialog.setAttribute('aria-labelledby', 'game-title');
  dialog.innerHTML =
    '<h2 class="game__title" id="game-title">Block Breaker — mini</h2>' +
    '<p class="game__hud" aria-hidden="true"></p>' +
    '<p class="visually-hidden" aria-live="polite"></p>' +
    '<canvas class="game__canvas" role="img" aria-label="Game board: bricks, a ball, and a paddle"></canvas>' +
    '<div class="game__pad">' +
    '<button type="button" class="btn game__move" data-dir="-1" aria-label="Move left">◀</button>' +
    '<button type="button" class="btn game__move" data-dir="1" aria-label="Move right">▶</button>' +
    '</div>' +
    '<div class="game__actions">' +
    '<button type="button" class="btn btn--primary" data-game-toggle>Start</button>' +
    '<button type="button" class="btn" data-game-close>Close</button>' +
    '</div>' +
    '<p class="game__help">Move: pointer, ← → or A D. Start or pause: Space.</p>';

  const canvas = dialog.querySelector('canvas') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof dialog.showModal !== 'function') return () => {};

  const hud = dialog.querySelector('.game__hud') as HTMLElement;
  const live = dialog.querySelector('[aria-live]') as HTMLElement;
  const pad = dialog.querySelector('.game__pad') as HTMLElement;
  const toggleBtn = dialog.querySelector('[data-game-toggle]') as HTMLButtonElement;
  const closeBtn = dialog.querySelector('[data-game-close]') as HTMLButtonElement;
  const openBtn = document.querySelector<HTMLElement>('[data-game-open]');

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  document.body.append(dialog);

  // Colors and font come from the design tokens.
  const style = getComputedStyle(dialog);
  const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  const cBg = token('--color-space', '#0d0916');
  const cText = token('--color-text', '#f4effa');
  const cAccent = token('--color-accent', '#e79ce1');
  const font = `600 18px ${style.fontFamily || 'sans-serif'}`;

  let state: State = 'ready';
  let message = '';
  let bricks: boolean[] = [];
  let left = 0;
  let score = 0;
  let lives = 3;
  let px = 0;
  let bx = 0;
  let by = 0;
  let vx = 0;
  let vy = 0;
  let speed = SPEED;
  let trail: number[] = [];
  let keyL = false;
  let keyR = false;
  let held = 0;
  let raf = 0;
  let last = 0;
  let lastSay = 0;
  let codeAt = 0;
  let opener: Element | null = null;

  const say = (force: boolean): void => {
    hud.textContent = `Score ${score} · Lives ${lives}`;
    const now = performance.now();
    if (!force && now - lastSay < 2500) return;
    lastSay = now;
    live.textContent = `${message ? `${message}. ` : ''}Score ${score}, lives ${lives}.`;
  };

  const draw = (): void => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = cBg;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < bricks.length; i++) {
      if (!bricks[i]) continue;
      ctx.fillStyle = COLORS[Math.floor(i / COLS)] ?? cText;
      ctx.fillRect(GAP + (i % COLS) * (BW + GAP), TOP + Math.floor(i / COLS) * (BH + GAP), BW, BH);
    }
    ctx.fillStyle = cAccent;
    const n = trail.length / 2;
    for (let i = 0; i < n; i++) {
      ctx.globalAlpha = ((i + 1) / n) * 0.3;
      ctx.beginPath();
      ctx.arc(trail[i * 2] ?? 0, trail[i * 2 + 1] ?? 0, R * (0.4 + (0.6 * i) / n), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowColor = cAccent;
    ctx.shadowBlur = 12;
    ctx.fillRect(px, PY, PW, PH);
    ctx.fillStyle = cText;
    ctx.beginPath();
    ctx.arc(bx, by, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (state !== 'run') {
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.fillText(message || (state === 'pause' ? 'Paused' : 'Press Start'), W / 2, H / 2 + 40);
    }
  };

  const end = (text: string): void => {
    message = text;
    setState('over');
    say(true);
  };

  const step = (dt: number): void => {
    px = clamp(px + (held || Number(keyR) - Number(keyL)) * PSPEED * dt, 0, W - PW);
    if (state !== 'run') {
      bx = px + PW / 2;
      by = PY - R;
      return;
    }
    speed = Math.min(SPEED_MAX, speed + ACCEL * dt);
    const k = speed / (Math.hypot(vx, vy) || 1);
    vx *= k;
    vy *= k;
    bx += vx * dt;
    by += vy * dt;
    if (bx < R) {
      bx = R;
      vx = Math.abs(vx);
    } else if (bx > W - R) {
      bx = W - R;
      vx = -Math.abs(vx);
    }
    if (by < R) {
      by = R;
      vy = Math.abs(vy);
    }
    // Paddle: the hit position sets the bounce angle.
    if (vy > 0 && by + R >= PY && by - R <= PY + PH && bx >= px - R && bx <= px + PW + R) {
      const angle = clamp((bx - px - PW / 2) / (PW / 2), -1, 1) * MAX_ANGLE;
      vx = speed * Math.sin(angle);
      vy = -speed * Math.cos(angle);
      by = PY - R;
    }
    // Bricks: one hit for each step.
    for (let i = 0; i < bricks.length; i++) {
      if (!bricks[i]) continue;
      const x = GAP + (i % COLS) * (BW + GAP);
      const y = TOP + Math.floor(i / COLS) * (BH + GAP);
      if (bx + R <= x || bx - R >= x + BW || by + R <= y || by - R >= y + BH) continue;
      bricks[i] = false;
      left--;
      score += 10;
      const ox = Math.min(bx + R - x, x + BW - bx + R);
      const oy = Math.min(by + R - y, y + BH - by + R);
      if (ox < oy) vx = bx < x + BW / 2 ? -Math.abs(vx) : Math.abs(vx);
      else vy = by < y + BH / 2 ? -Math.abs(vy) : Math.abs(vy);
      say(false);
      break;
    }
    if (!left) {
      end('You win');
    } else if (by > H + R) {
      lives--;
      trail = [];
      if (lives) {
        message = 'Ball lost';
        speed = SPEED;
        setState('ready');
        say(true);
      } else {
        end('Game over');
      }
    }
  };

  const frame = (now: number): void => {
    raf = 0;
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    const steps = Math.max(1, Math.ceil(dt * 240));
    for (let i = 0; i < steps && (state === 'run' || state === 'ready'); i++) step(dt / steps);
    if (state === 'run') {
      trail.push(bx, by);
      if (trail.length > 16) trail.splice(0, 2);
    }
    draw();
    loop();
  };

  // The loop runs only when the dialog is open, the tab is visible, and the game is live.
  function loop(): void {
    if (raf || !dialog.open || document.hidden || (state !== 'run' && state !== 'ready')) return;
    raf = requestAnimationFrame(frame);
  }

  // Start the loop after a stop: the first frame must not see the idle time.
  function start(): void {
    if (!raf) last = performance.now();
    loop();
  }

  function setState(next: State): void {
    state = next;
    toggleBtn.textContent = LABEL[next];
    if (next === 'pause' || next === 'over') {
      cancelAnimationFrame(raf);
      raf = 0;
      draw();
    } else {
      start();
    }
  }

  const reset = (): void => {
    bricks = new Array<boolean>(COLS * COLORS.length).fill(true);
    left = bricks.length;
    score = 0;
    lives = 3;
    speed = SPEED;
    px = (W - PW) / 2;
    bx = W / 2;
    by = PY - R;
    trail = [];
    message = '';
    keyL = keyR = false;
    held = 0;
  };

  const toggle = (): void => {
    if (state === 'run') {
      message = '';
      setState('pause');
      return;
    }
    if (state === 'over') reset();
    if (state !== 'pause') {
      // Launch: up, a little to one side.
      vx = speed * 0.3 * (Math.random() < 0.5 ? -1 : 1);
      vy = -speed;
    }
    message = '';
    setState('run');
    say(true);
  };

  const open = (): void => {
    if (dialog.open) return;
    opener = document.activeElement;
    reset();
    dialog.showModal();
    setState('ready');
    say(true);
    draw();
    toggleBtn.focus();
  };

  const close = (): void => {
    if (dialog.open) dialog.close();
  };

  const onClosed = (): void => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (state === 'run') setState('pause');
    keyL = keyR = false;
    held = 0;
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    opener = null;
  };

  const onKey = (event: KeyboardEvent): void => {
    const down = event.type === 'keydown';
    const key = event.key.toLowerCase();
    if (key === 'arrowleft' || key === 'a') keyL = down;
    else if (key === 'arrowright' || key === 'd') keyR = down;
    else if (key === ' ' && down && !(event.target instanceof HTMLButtonElement)) toggle();
    else return; // also Space on a button: the native click does the work
    event.preventDefault();
  };

  const onPointer = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || (state !== 'run' && state !== 'ready')) return;
    px = clamp(((event.clientX - rect.left) / rect.width) * W - PW / 2, 0, W - PW);
  };

  const onPad = (event: PointerEvent): void => {
    const button = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-dir]') : null;
    if (event.type === 'pointerdown' && button) {
      held = Number(button.dataset.dir) || 0;
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        // No capture: pointerup on the pad still stops the move.
      }
    } else if (event.type !== 'pointerdown') {
      held = 0;
    }
  };
  const noMenu = (event: Event): void => event.preventDefault();

  const onVisibility = (): void => {
    if (document.hidden) {
      if (state === 'run') setState('pause');
    } else {
      start();
    }
  };

  const onCode = (event: KeyboardEvent): void => {
    if (dialog.open) return;
    const up = event.key === CODE[0];
    codeAt = event.key === CODE[codeAt] ? codeAt + 1 : up ? (codeAt === 2 ? 2 : 1) : 0;
    if (codeAt === CODE.length) {
      codeAt = 0;
      open();
    }
  };

  dialog.addEventListener('close', onClosed);
  dialog.addEventListener('keydown', onKey);
  dialog.addEventListener('keyup', onKey);
  canvas.addEventListener('pointermove', onPointer);
  canvas.addEventListener('pointerdown', onPointer);
  pad.addEventListener('pointerdown', onPad);
  pad.addEventListener('pointerup', onPad);
  pad.addEventListener('pointercancel', onPad);
  pad.addEventListener('lostpointercapture', onPad);
  pad.addEventListener('contextmenu', noMenu);
  toggleBtn.addEventListener('click', toggle);
  closeBtn.addEventListener('click', close);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('keydown', onCode);
  if (openBtn) {
    openBtn.addEventListener('click', open);
    openBtn.hidden = false;
  }

  return () => {
    close();
    onClosed(); // the `close` event is async: clean up now
    cancelAnimationFrame(raf);
    dialog.removeEventListener('close', onClosed);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('keydown', onCode);
    if (openBtn) {
      openBtn.removeEventListener('click', open);
      openBtn.hidden = true;
    }
    dialog.remove();
  };
}
