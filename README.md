# showcase

## What this is

This is the projects showcase of Wojciech Krupa: five projects as five planets.
The live site is https://wojkr.github.io/showcase/.
The site is static. It has no server code.

## Stack

- [Astro](https://astro.build/) 7 (static output to `dist/`), TypeScript, plain CSS with tokens
- [Three.js](https://threejs.org/) for the WebGL space scene (loaded after the first paint)
- [GSAP](https://gsap.com/) + ScrollTrigger for the scroll effects (loaded only when animations are on)
- Manrope and Unbounded fonts (self-hosted through Fontsource)
- GitHub Actions and GitHub Pages for deployment

Node `>=22.23.4` is necessary. The deploy workflow uses Node 24.

## Local commands

| Command           | Result                                                                |
| ----------------- | --------------------------------------------------------------------- |
| `npm install`     | Installs the dependencies.                                            |
| `npm run dev`     | Starts the dev server with live reload.                               |
| `npm run build`   | Builds the site into `dist/`.                                         |
| `npm run preview` | Serves the built `dist/` folder at `http://localhost:4321/showcase/`. |
| `npm run check`   | Runs `astro check` (types and Astro diagnostics).                     |

## Update content

All content is in data files. Do not put content in the layout files. The build fails if the data is invalid.

| To change                                           | Edit this file              |
| --------------------------------------------------- | --------------------------- |
| Site title, hero text, pilot text, profile links    | `src/content/site.json`     |
| Projects (title, text, stack, links, colors, media) | `src/content/projects.json` |

### Project fields

| Field                  | Meaning                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `id`                   | Slug. It is the section anchor (`#ride-rite`).                                                        |
| `legacyId`             | Number 1–5. It keeps the old anchors `#1`…`#5` alive. Each number must be unique.                     |
| `order`                | Position on the page.                                                                                 |
| `liveUrl`, `sourceUrl` | Demo link and repository link. `sourceUrl` is optional.                                               |
| `extraLinks`           | Optional. Extra buttons after "Live demo": `[{ "label": "…", "url": "https://…" }]`. Short labels.    |
| `wakeUrl`              | Optional. One URL or an array of URLs. The page requests each on load to wake a sleeping demo server. |
| `embed`                | `true` shows the "Play here" button (the demo opens in an iframe on click).                           |
| `accent`               | Color of the stage and of the planet. Contrast must be at least 4.5:1 on `#1a1426`.                   |
| `poster`, `posterAlt`  | Screenshot (1600×1000 WebP in `src/assets/media/`) and its text alternative.                          |
| `video`                | Optional. `media/<name>` → the files `public/media/<name>.webm` and `.mp4` (1280×800, muted, 6–10 s). |
| `planet`               | Look of the 3D planet: `radius`, `seed`, `rings`, `hue`.                                              |

### Add a project

1. Put the poster in `src/assets/media/` and, if you have one, the video pair in `public/media/`.
2. Add an entry to `src/content/projects.json`. Use the same format as the other entries.
3. Run `npm run build`.

## Animations

- All effects run only when `<html>` has `data-motion="on"`.
- The default follows the system setting "reduce motion". The **Animations** button in the header overrides it. The browser stores the choice in `localStorage` (key `motion`).
- With animations off, or without JavaScript, the site is a static gallery.
- Weak devices get a lighter scene. Devices with no WebGL, or with data saver on, get a static background. To test: add `?tier=high`, `?tier=low`, or `?tier=none` to the URL.
- State logic: `src/scripts/motion.ts`. Module wiring: `src/scripts/boot.ts`. Scene: `src/scripts/scene/`. Effect styles: `src/styles/effects.css`, `src/styles/interactions.css`.

## Base path

The site is a GitHub Pages project site. The base path equals the repository name.
It is one value: `BASE` in `astro.config.mjs`. Change it there if the repository name changes.

## Deploy

1. Push to `main`.
2. The workflow `.github/workflows/deploy.yml` builds the site and deploys it to GitHub Pages.

One-time setup: in the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
