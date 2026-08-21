// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://lokeshnanda.com',
  integrations: [sitemap()],
  redirects: {
    // Started life as a learnings note, promoted to a full post
    '/learnings/this-site-ships-itself/': '/blog/this-site-ships-itself/',
  },
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
