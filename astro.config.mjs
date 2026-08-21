// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import { rehypeHeadingIds } from '@astrojs/markdown-remark';

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
    rehypePlugins: [
      // Astro normally assigns heading ids after custom plugins run, which is
      // too late for autolink — so run its id plugin explicitly first.
      rehypeHeadingIds,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'append',
          properties: {
            className: ['heading-anchor'],
            ariaLabel: 'Link to this section',
            // Keep the "#" glyph out of the Pagefind search index
            'data-pagefind-ignore': 'all',
          },
          content: { type: 'text', value: '#' },
        },
      ],
    ],
  },
});
