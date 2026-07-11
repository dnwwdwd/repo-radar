export type RepoStatus = "queued" | "analyzing" | "analyzed" | "failed" | "ignored" | "archived";

export type Analysis = {
  summary: string;
  purpose: string;
  features: string[];
  target_users: string[];
  tech_stack: string[];
  deployment_notes: string;
  license: string;
  evidence: string[];
  confidence: number;
  agent_log: { thought: string; action: string }[];
  analyzed_at: string;
};

export type Repo = {
  id: number;
  full_name: string;
  html_url: string;
  description: string;
  language: string;
  stars: number;
  topics: string[];
  repo_license: string;
  created_at: string;
  fetched_at: string;
  status: RepoStatus;
  retry_count: number;
  failure_message: string;
  source_strategy_ids: string[];
  analysis: Analysis;
};

export type Strategy = {
  id: string;
  name: string;
  enabled: boolean;
  query: string;
  stars_min: number;
  stars_max: number;
  max_pages: number;
  pages_per_run: number;
  per_run_target: number;
};

export type AppConfig = {
  search: {
    cron: string;
    created_window_days: number;
    created_lookback_days: number;
    exclude_forks: boolean;
    exclude_archived: boolean;
    seen_cooldown_days: number;
    max_strategy_runs_per_tick: number;
    max_new_repos_per_tick: number;
    cooldown_skip_page_threshold: number;
    max_cooldown_extra_pages_per_strategy: number;
    strategies: Strategy[];
  };
  agent: { cron: string; batch_size: number; max_turns: number; failure_retry_limit: number };
  providers: { name: string; base_url: string; model: string; active: boolean }[];
  notify: { instant_enabled: boolean; daily_digest_enabled: boolean; daily_digest_crons: string[] };
  feishu: { group_chat_id: string };
  control: { crawl_enabled: boolean; agent_enabled: boolean };
};

export type StatusResponse = {
  service: { status: string; scheduler_running: boolean };
  github: { state: string; message: string; remaining: number | null; degraded_mode: boolean; crawl_paused: boolean };
  queues: Record<RepoStatus, number>;
  agent: { active_provider: string; provider_configured: boolean };
  feishu: { app_configured: boolean; group_chat_configured: boolean; group_chat_id_masked: string };
  controls: { crawl: { enabled: boolean; running: boolean }; agent: { enabled: boolean; running: boolean } };
  tasks: { id: string; name: string; status: string; next_run: string }[];
  runtime_events: { id: number; category: string; event_type: string; status: string; summary: string; created_at: string }[];
};

export type SecretsMeta = {
  github_token: { configured: boolean; masked: string };
  providers: Record<string, { configured: boolean; masked: string }>;
  feishu: { app_configured: boolean; group_chat_configured: boolean; group_chat_id_masked: string };
};
