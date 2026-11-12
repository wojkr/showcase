// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/*
 * BASE is the one place that holds the base path (= the GitHub repo name).
 * To move the site to another repo, change BASE only.
 * In code, build URLs with `import.meta.env.BASE_URL` (it ends with "/").
 */
const BASE = '/showcase';

export default defineConfig({
  site: 'https://wojkr.github.io',
  base: BASE,
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  build: {
    inlineStylesheets: 'auto',
  },
});
