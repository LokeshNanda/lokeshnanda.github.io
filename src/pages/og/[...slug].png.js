/**
 * Build-time OG image generation (1200x630 PNG per page).
 * /og/site.png            — default card (homepage, listings)
 * /og/blog/<id>.png       — one per blog post
 * /og/learnings/<id>.png  — one per weekly learnings note
 */
import { getCollection } from 'astro:content';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';

const WIDTH = 1200;
const HEIGHT = 630;

// Fixed light palette — social cards don't have a dark mode.
const PAPER = '#f8f7fc';
const INK = '#262450';
const DIM = '#605e80';
const PRIMARY = '#5a50c7';
const LINE = '#e3e1f0';

const fontFile = (weight) =>
  readFile(
    new URL(
      `../../../node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-${weight}-normal.woff`,
      import.meta.url
    )
  );

export async function getStaticPaths() {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  const notes = await getCollection('learnings', ({ data }) => !data.draft);
  const fmt = (d) =>
    d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

  return [
    {
      params: { slug: 'site' },
      props: {
        kicker: 'DATA · CLOUD · AI PRODUCTS',
        title: 'I build apps, AI products and data platforms.',
        meta: 'Apps, interactive demos and writing — live on this site.',
      },
    },
    ...posts.map((p) => ({
      params: { slug: `blog/${p.id}` },
      props: {
        kicker: 'BLOG',
        title: p.data.title,
        meta: [fmt(p.data.date), ...p.data.tags.slice(0, 3)].join('  ·  '),
      },
    })),
    ...notes.map((n) => ({
      params: { slug: `learnings/${n.id}` },
      props: {
        kicker: 'WEEKLY LEARNINGS',
        title: n.data.title,
        meta: [fmt(n.data.date), ...n.data.tags.slice(0, 3)].join('  ·  '),
      },
    })),
  ];
}

export async function GET({ props }) {
  const { kicker, title, meta } = props;
  const [medium, extrabold] = await Promise.all([fontFile('500'), fontFile('800')]);

  // Long titles get a smaller size so they never clip.
  const titleSize = title.length > 70 ? 54 : title.length > 40 ? 62 : 72;

  const svg = await satori(
    {
      type: 'div',
      props: {
        style: {
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: PAPER,
          borderTop: `14px solid ${PRIMARY}`,
          padding: '64px 72px 56px',
          fontFamily: 'Bricolage',
        },
        children: [
          {
            type: 'div',
            props: {
              style: {
                fontSize: 26,
                fontWeight: 500,
                letterSpacing: '0.14em',
                color: PRIMARY,
              },
              children: kicker,
            },
          },
          {
            type: 'div',
            props: {
              style: {
                flexGrow: 1,
                display: 'flex',
                alignItems: 'center',
              },
              children: {
                type: 'div',
                props: {
                  style: {
                    fontSize: titleSize,
                    fontWeight: 800,
                    lineHeight: 1.12,
                    letterSpacing: '-0.02em',
                    color: INK,
                    maxWidth: 1000,
                  },
                  children: title,
                },
              },
            },
          },
          {
            type: 'div',
            props: {
              style: {
                fontSize: 26,
                fontWeight: 500,
                color: DIM,
                paddingBottom: 28,
              },
              children: meta,
            },
          },
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderTop: `2px solid ${LINE}`,
                paddingTop: 28,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 32, fontWeight: 800, color: INK },
                    children: 'Lokesh Nanda',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { fontSize: 28, fontWeight: 500, color: PRIMARY },
                    children: 'lokeshnanda.com',
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: 'Bricolage', data: medium, weight: 500, style: 'normal' },
        { name: 'Bricolage', data: extrabold, weight: 800, style: 'normal' },
      ],
    }
  );

  const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
}
