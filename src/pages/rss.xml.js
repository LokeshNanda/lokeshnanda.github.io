import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).map((p) => ({
    title: p.data.title,
    description: p.data.description,
    pubDate: p.data.date,
    link: `/blog/${p.id}/`,
  }));

  const learnings = (await getCollection('learnings', ({ data }) => !data.draft)).map((l) => ({
    title: l.data.title,
    description: l.data.description,
    pubDate: l.data.date,
    link: `/learnings/${l.id}/`,
  }));

  const items = [...posts, ...learnings].sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf());

  return rss({
    title: 'Lokesh Nanda — Blog & Weekly Learnings',
    description: 'Deep dives and short weekly notes on data platforms, cloud and AI products.',
    site: context.site,
    items,
  });
}
