export interface JobConfig {
  keywordPool?: string[];
  keywordStrategy?: 'random' | 'round_robin';
  textModel?: { provider: string; model: string };
  imageModel?: { provider: string; model: string };
  prompts?: {
    articleSystem?: string;
    articleUser?: string;
    imagePrompt?: string;
  };
  seoRules?: {
    minWordCount?: number;
    maxTitleLength?: number;
    requireKeywordInTitle?: boolean;
    minSeoScore?: number;
  };
  channels?: {
    facebookPage?: {
      enabled?: boolean;
      pageId?: string;
      requireApproval?: boolean;
      postType?: 'photo' | 'link';
    };
    facebookGroupManual?: {
      enabled?: boolean;
      groupUrl?: string;
      shareTemplate?: string;
    };
  };
}

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  FACEBOOK_PAGE_ID?: string;
  FACEBOOK_PAGE_TOKEN?: string;
  ALLOWED_ORIGINS?: string;
  AI: Ai;
}

export interface Ai {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface JobRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  status: 'active' | 'paused' | 'disabled';
  cron_expression: string;
  timezone: string;
  config: JobConfig;
}

export interface ContentDraftRow {
  id: string;
  project_id: string;
  job_id: string;
  run_id: string;
  keyword: string;
  title: string | null;
  body: string | null;
  meta_description: string | null;
  seo_score: number | null;
  seo_report: Record<string, unknown> | null;
  image_storage_path: string | null;
  image_alt: string | null;
  status: string;
}
