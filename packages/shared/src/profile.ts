import { z } from 'zod';

export const ExperienceItemSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  location: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  current: z.boolean().optional(),
  description: z.string().optional(),
  highlights: z.array(z.string()).optional(),
});

export const EducationItemSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().min(1),
  field_of_study: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const PreferencesSchema = z
  .object({
    locations: z.array(z.string()).default([]),
    remote: z.boolean().default(true),
    roles: z.array(z.string()).optional(),
    manual_daily_target: z.number().int().min(1).optional(),
  })
  .passthrough();

export const FiltersSchema = z
  .object({
    titles: z.array(z.string()).default([]),
    title_include: z.array(z.string()).optional(),
    title_exclude: z.array(z.string()).optional(),
    locations: z.array(z.string()).default([]),
    remote: z.boolean().optional(),
    min_salary: z.number().nullable().optional(),
    experience_range: z
      .object({
        min: z.number().min(0).optional(),
        max: z.number().min(0).optional(),
      })
      .optional(),
    company_blacklist: z.array(z.string()).default([]),
    min_score: z
      .number({ invalid_type_error: 'min_score must be a number' })
      .min(0, 'min_score cannot be negative')
      .max(100, 'min_score cannot exceed 100')
      .default(0),
    require_salary: z.boolean().default(false),
  })
  .passthrough();

export const TimeStringSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'Invalid time format: must be HH:MM in 24-hour format');

export const SendSettingsSchema = z
  .object({
    daily_cap: z
      .number()
      .int('Daily cap must be an integer')
      .min(1, 'Daily cap must be between 1 and 200')
      .max(200, 'Daily cap must be between 1 and 200'),
    window: z
      .object({
        start: TimeStringSchema, // e.g. "09:00"
        end: TimeStringSchema, // e.g. "17:00"
      })
      .refine((w) => w.start < w.end, {
        message: 'Send window start time must be earlier than end time',
      }),
    timezone: z.string().min(1),
    ramp_base: z.number().int().min(0).max(100),
    ramp_step: z.number().int().min(0).max(50),
    auto_approve_above_score: z.number().min(0).max(100),
    max_follow_ups: z.number().int().min(0).max(5).optional(),
  })
  .passthrough();

export const AnswersSchema = z
  .object({
    notice_period: z.string(),
    current_ctc: z.string(),
    expected_ctc: z.string(),
    work_authorisation: z.string(),
    links: z.record(z.string(), z.string()).default({}),
    other: z.record(z.string(), z.string()).default({}),
  })
  .passthrough();

export const ProfileSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  skills: z.array(z.string().min(1)).min(1),
  experience_years: z.number().min(0).optional(),
  experience: z.array(ExperienceItemSchema).default([]),
  education: z.array(EducationItemSchema).default([]),
  preferences: PreferencesSchema.default({}),
  filters: FiltersSchema,
  send_settings: SendSettingsSchema,
  answers: AnswersSchema,
});

export type ExperienceItem = z.infer<typeof ExperienceItemSchema>;
export type EducationItem = z.infer<typeof EducationItemSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type Filters = z.infer<typeof FiltersSchema>;
export type SendSettings = z.infer<typeof SendSettingsSchema>;
export type Answers = z.infer<typeof AnswersSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
