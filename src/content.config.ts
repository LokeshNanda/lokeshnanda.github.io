import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const postSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  date: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  // For posts originally published elsewhere (e.g. Medium)
  canonical: z.string().url().optional(),
});

// Long-form articles — occasional, text-heavy, image-rich deep dives
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: postSchema,
});

// Weekly learnings — short, regular notes
const learnings = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/learnings' }),
  schema: postSchema,
});

export const collections = { posts, learnings };
