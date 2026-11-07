import { z } from 'zod';

export const AdzunaItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string().max(1000).optional(),
    company: z
      .union([z.object({ display_name: z.string().max(500).optional() }), z.string().max(500)])
      .optional(),
    location: z
      .union([z.object({ display_name: z.string().max(500).optional() }), z.string().max(500)])
      .optional(),
    description: z.string().max(100000).optional(),
    redirect_url: z.string().max(5000).optional(),
    salary_min: z.number().optional(),
    salary_max: z.number().optional(),
    created: z.string().max(100).optional(),
  })
  .passthrough();

export const AdzunaResponseSchema = z.object({
  results: z.array(AdzunaItemSchema).max(500).optional(),
});

export const RemoteOkItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    position: z.string().max(1000).optional(),
    company: z.string().max(500).optional(),
    location: z.string().max(500).optional(),
    description: z.string().max(100000).optional(),
    url: z.string().max(5000).optional(),
    salary_min: z.number().optional(),
    salary_max: z.number().optional(),
    date: z.string().max(100).optional(),
    epoch: z.number().optional(),
  })
  .passthrough();

export const RemoteOkResponseSchema = z.array(RemoteOkItemSchema).max(1000);

export const RemotiveItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string().max(1000).optional(),
    company_name: z.string().max(500).optional(),
    candidate_required_location: z.string().max(500).optional(),
    description: z.string().max(100000).optional(),
    url: z.string().max(5000).optional(),
    salary: z.string().max(500).optional(),
    publication_date: z.string().max(100).optional(),
  })
  .passthrough();

export const RemotiveResponseSchema = z.object({
  jobs: z.array(RemotiveItemSchema).max(1000).optional(),
});

export const WeWorkRemotelyItemSchema = z
  .object({
    id: z.string().max(500).optional(),
    title: z.string().max(1000).optional(),
    link: z.string().max(5000).optional(),
    description: z.string().max(100000).optional(),
    pubDate: z.string().max(100).optional(),
    source: z.string().max(100).optional(),
  })
  .passthrough();

export const WeWorkRemotelyJobsSchema = z.array(WeWorkRemotelyItemSchema).max(500);

export const HnHitItemSchema = z
  .object({
    objectID: z.string().max(100).optional(),
    author: z.string().max(200).optional(),
    comment_text: z.string().max(100000).optional(),
    created_at: z.string().max(100).optional(),
    story_id: z.number().optional(),
  })
  .passthrough();

export const HnSearchResponseSchema = z.object({
  hits: z.array(HnHitItemSchema).max(50).optional(),
});

export const HnCommentsResponseSchema = z.object({
  hits: z.array(HnHitItemSchema).max(200).optional(),
});

export const GreenhouseJobItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string().max(1000).optional(),
    absolute_url: z.string().max(5000).optional(),
    location: z.object({ name: z.string().max(500).optional() }).optional(),
    content: z.string().max(100000).optional(),
    updated_at: z.string().max(100).optional(),
  })
  .passthrough();

export const GreenhouseResponseSchema = z.object({
  jobs: z.array(GreenhouseJobItemSchema).max(1000).optional(),
});

export const LeverJobItemSchema = z
  .object({
    id: z.string().max(100).optional(),
    text: z.string().max(1000).optional(),
    hostedUrl: z.string().max(5000).optional(),
    categories: z
      .object({
        location: z.string().max(500).optional(),
        commitment: z.string().max(200).optional(),
        team: z.string().max(200).optional(),
      })
      .optional(),
    descriptionPlain: z.string().max(100000).optional(),
    description: z.string().max(100000).optional(),
    createdAt: z.number().optional(),
  })
  .passthrough();

export const LeverResponseSchema = z.array(LeverJobItemSchema).max(1000);

export const AshbyJobItemSchema = z
  .object({
    id: z.string().max(100).optional(),
    title: z.string().max(1000).optional(),
    jobUrl: z.string().max(5000).optional(),
    location: z.string().max(500).optional(),
    isRemote: z.boolean().optional(),
    descriptionPlain: z.string().max(100000).optional(),
    descriptionHtml: z.string().max(100000).optional(),
    publishedAt: z.string().max(100).optional(),
  })
  .passthrough();

export const AshbyResponseSchema = z.object({
  jobs: z.array(AshbyJobItemSchema).max(1000).optional(),
});
