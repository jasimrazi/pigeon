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

// SmartRecruiters ATS
export const SmartRecruitersItemSchema = z
  .object({
    id: z.string().max(100).optional(),
    name: z.string().max(1000).optional(),
    company: z.object({ name: z.string().max(500).optional() }).optional(),
    location: z
      .object({
        city: z.string().max(200).optional(),
        region: z.string().max(200).optional(),
        country: z.string().max(200).optional(),
        remote: z.boolean().optional(),
      })
      .optional(),
    releasedDate: z.string().max(100).optional(),
  })
  .passthrough();

export const SmartRecruitersResponseSchema = z.object({
  content: z.array(SmartRecruitersItemSchema).max(1000).optional(),
});

// Workable ATS
export const WorkableItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    shortcode: z.string().max(100).optional(),
    title: z.string().max(1000).optional(),
    url: z.string().max(5000).optional(),
    location: z
      .object({
        city: z.string().max(200).optional(),
        region: z.string().max(200).optional(),
        country: z.string().max(200).optional(),
        telecommuting: z.boolean().optional(),
      })
      .optional(),
    published: z.string().max(100).optional(),
  })
  .passthrough();

export const WorkableResponseSchema = z.object({
  results: z.array(WorkableItemSchema).max(1000).optional(),
});

// Breezy HR ATS
export const BreezyJobItemSchema = z
  .object({
    id: z.string().max(100).optional(),
    name: z.string().max(1000).optional(),
    url: z.string().max(5000).optional(),
    company: z.object({ name: z.string().max(500).optional() }).optional(),
    location: z
      .object({
        name: z.string().max(500).optional(),
        is_remote: z.boolean().optional(),
      })
      .optional(),
    updated_at: z.string().max(100).optional(),
  })
  .passthrough();

export const BreezyResponseSchema = z.array(BreezyJobItemSchema).max(1000);

// BambooHR ATS
export const BambooHrJobItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    jobOpeningName: z.string().max(1000).optional(),
    location: z
      .object({
        city: z.string().max(200).optional(),
        state: z.string().max(200).optional(),
      })
      .optional(),
    isRemote: z.union([z.boolean(), z.number(), z.string()]).optional(),
  })
  .passthrough();

export const BambooHrResponseSchema = z.object({
  result: z.array(BambooHrJobItemSchema).max(1000).optional(),
});

// Recruitee ATS
export const RecruiteeJobItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string().max(1000).optional(),
    careers_url: z.string().max(5000).optional(),
    company_name: z.string().max(500).optional(),
    location: z.string().max(500).optional(),
    remote: z.boolean().optional(),
    published_at: z.string().max(100).optional(),
  })
  .passthrough();

export const RecruiteeResponseSchema = z.object({
  offers: z.array(RecruiteeJobItemSchema).max(1000).optional(),
});

// Himalayas Remote Jobs API
export const HimalayasJobItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string().max(1000).optional(),
    company_name: z.string().max(500).optional(),
    location: z.string().max(500).optional(),
    min_salary: z.number().optional(),
    max_salary: z.number().optional(),
    currency: z.string().max(50).optional(),
    application_url: z.string().max(5000).optional(),
    description: z.string().max(100000).optional(),
    pub_date: z.string().max(100).optional(),
  })
  .passthrough();

export const HimalayasResponseSchema = z.object({
  data: z.array(HimalayasJobItemSchema).max(500).optional(),
});

// Jobicy Remote Jobs API
export const JobicyJobItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    jobTitle: z.string().max(1000).optional(),
    companyName: z.string().max(500).optional(),
    jobGeo: z.string().max(500).optional(),
    annualSalaryMin: z.union([z.number(), z.string()]).optional(),
    annualSalaryMax: z.union([z.number(), z.string()]).optional(),
    salaryCurrency: z.string().max(50).optional(),
    url: z.string().max(5000).optional(),
    jobDescription: z.string().max(100000).optional(),
    pubDate: z.string().max(100).optional(),
  })
  .passthrough();

export const JobicyResponseSchema = z.object({
  jobs: z.array(JobicyJobItemSchema).max(500).optional(),
});

// Working Nomads Remote Jobs API
export const WorkingNomadsJobItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string().max(1000).optional(),
    company_name: z.string().max(500).optional(),
    location: z.string().max(500).optional(),
    url: z.string().max(5000).optional(),
    description: z.string().max(100000).optional(),
    pub_date: z.string().max(100).optional(),
  })
  .passthrough();

export const WorkingNomadsResponseSchema = z.array(WorkingNomadsJobItemSchema).max(500);
