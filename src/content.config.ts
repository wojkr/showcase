/*
 * Content model. All site content is in `src/content/*.json`.
 * To update the texts or the projects: edit the JSON only. The build fails if the data is invalid.
 *
 * How to query (in the frontmatter of an .astro file):
 *
 *   import { getCollection, getEntry } from 'astro:content';
 *
 *   // site — one entry, id "site". `site.pilot.image` is ImageMetadata for <Image />.
 *   const site = (await getEntry('site', 'site'))!.data;
 *
 *   // projects — sort by `order`. `poster` is ImageMetadata:
 *   //   <Image src={project.poster} alt={project.posterAlt} />   (import { Image } from 'astro:assets')
 *   const projects = (await getCollection('projects'))
 *     .map((e) => e.data)
 *     .sort((a, b) => a.order - b.order);
 *
 *   // video — public path without extension, relative to BASE_URL:
 *   //   `${import.meta.env.BASE_URL}${project.video}.webm` and `.mp4`
 *
 * Notes:
 * - `getCollection()` does not guarantee order. Always sort by `order`.
 * - Image paths in JSON are relative to the JSON file, e.g. "../assets/media/pilot.webp".
 * - Each project needs a unique `id`. The `id` is also the section id on the page (`#ride-rite`).
 * - `legacyId` is the old anchor number (`#1` … `#5`) of the previous showcase. Old links depend on it.
 *   Each project must have a different `legacyId`. The schema checks one item at a time,
 *   so it CANNOT check this. Check it by hand when you edit `projects.json`. The same applies to `order`.
 * - `accent` must have a contrast of 4.5:1 or more on `#1a1426`. The schema checks only the format.
 * - Unknown keys are errors (they catch typos).
 */
import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { z } from 'astro/zod';

const text = z.string().trim().min(1);
const httpsUrl = z.url({ protocol: /^https$/ });
const order = z.number().int().nonnegative();

const site = defineCollection({
  // site.json is one plain object. The parser wraps it as the single entry "site".
  loader: file('src/content/site.json', {
    parser: (raw) => [{ id: 'site', ...JSON.parse(raw) }],
  }),
  schema: ({ image }) =>
    z.strictObject({
      id: z.literal('site'),
      name: text,
      /** Text of <title>. */
      title: text,
      /** Meta description. */
      description: text.max(160),
      heroKicker: text,
      heroTitle: text,
      heroLead: text,
      pilot: z.strictObject({
        heading: text,
        text: text,
        image: image(),
        imageAlt: text,
      }),
      links: z.strictObject({
        portfolio: httpsUrl,
        github: httpsUrl,
        linkedin: httpsUrl,
      }),
    }),
});

const projects = defineCollection({
  loader: file('src/content/projects.json'),
  schema: ({ image }) =>
    z.strictObject({
      /** Slug. Also the section id on the page. */
      id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use a lowercase slug, e.g. "ride-rite"'),
      /** Old anchor number of the previous showcase. Must be unique (not checked here; see the header). */
      legacyId: z.number().int().min(1).max(5),
      order,
      title: text,
      type: text,
      stack: z.array(text).min(1),
      /** One sentence. */
      summary: text,
      /** 2–3 sentences. */
      description: text,
      liveUrl: httpsUrl,
      sourceUrl: httpsUrl.optional(),
      /** Optional URL to request on page load, to wake a sleeping demo server. */
      wakeUrl: httpsUrl.optional(),
      /** true = the page may show the live demo in an iframe ("Play here"). */
      embed: z.boolean().default(false),
      /** Planet and stage colour. Contrast on #1a1426 must be 4.5:1 or more. */
      accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour, e.g. "#77C5F9"'),
      poster: image(),
      posterAlt: text,
      /** Public path without extension, relative to BASE_URL. The files are `.webm` and `.mp4`. */
      video: z
        .string()
        .regex(/^media\/[a-z0-9-]+$/, 'Use "media/{name}" without an extension')
        .optional(),
      planet: z.strictObject({
        radius: z.number().min(0.5).max(3),
        seed: z.number().int(),
        rings: z.boolean(),
        /** Degrees on the colour wheel. */
        hue: z.number().min(0).max(360),
      }),
    }),
});

export const collections = { site, projects };
