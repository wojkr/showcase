/*
 * wake.ts — wakes the sleeping demo servers (free hosting) of the projects.
 *
 * Group: ALWAYS. Input: the element with `data-wake-urls` (a JSON array of URLs
 * on <main>). Runs only on the production host (the hostname of
 * `import.meta.env.SITE`). Sends one request per URL after the page load, when
 * the browser is idle. Ignores all errors. Logs nothing.
 * The page-load wake also covers the "Live demo" links: there are no more requests.
 */

export type Dispose = () => void;

function readWakeUrls(): string[] {
  const raw = document.querySelector<HTMLElement>('[data-wake-urls]')?.dataset.wakeUrls;
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((url): url is string => typeof url === 'string' && url.startsWith('https://'));
  } catch {
    return [];
  }
}

function wakeServers(): void {
  for (const url of readWakeUrls()) {
    try {
      // Opaque response; only the request matters.
      fetch(url, { mode: 'no-cors', cache: 'no-store', keepalive: true }).catch(() => {});
    } catch {
      // Ignore: a failed wake-up must not affect the page.
    }
  }
}

function isProductionHost(): boolean {
  try {
    return location.hostname === new URL(import.meta.env.SITE ?? '').hostname;
  } catch {
    return false;
  }
}

export function init(): Dispose {
  if (!isProductionHost()) return () => {};

  let idleId: number | undefined;
  let timerId: number | undefined;

  const schedule = (): void => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(() => {
        idleId = undefined;
        wakeServers();
      });
    } else {
      timerId = window.setTimeout(() => {
        timerId = undefined;
        wakeServers();
      }, 1000);
    }
  };

  if (document.readyState === 'complete') {
    schedule();
  } else {
    window.addEventListener('load', schedule, { once: true });
  }

  return () => {
    window.removeEventListener('load', schedule);
    if (idleId !== undefined && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId);
    if (timerId !== undefined) window.clearTimeout(timerId);
    idleId = undefined;
    timerId = undefined;
  };
}
