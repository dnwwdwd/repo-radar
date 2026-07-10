import type { AppConfig, Repo, SecretsMeta, StatusResponse } from "./types";

type RepoList = { items: Repo[]; pagination: { page: number; page_size: number; total: number }; languages: string[] };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(init?.headers || {}) }, ...init });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || payload.detail?.message || `请求失败：${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  repos: (params: Record<string, string | number | string[] | undefined>) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach((item) => search.append(key, item));
      else if (value !== undefined && value !== "") search.set(key, String(value));
    });
    return request<RepoList>(`/api/repos?${search}`);
  },
  updateRepoStatus: (id: number, status: string) => request<Repo>(`/api/repos/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) }),
  cleanup: (mode: string, date?: string) => request<{ archived_count: number }>("/api/repos/cleanup", { method: "POST", body: JSON.stringify({ mode, date }) }),
  config: () => request<AppConfig>("/api/config"),
  saveConfig: (payload: Partial<AppConfig>) => request<{ config: AppConfig }>("/api/config", { method: "PUT", body: JSON.stringify(payload) }),
  resetCrawlState: (clearSeen: boolean) => request<{ deleted_states: number; deleted_seen: number }>("/api/config/crawl-state/reset", { method: "POST", body: JSON.stringify({ clear_seen: clearSeen }) }),
  status: () => request<StatusResponse>("/api/status"),
  secrets: () => request<SecretsMeta>("/api/secrets"),
  saveSecrets: (payload: Record<string, unknown>) => request<SecretsMeta>("/api/secrets", { method: "PUT", body: JSON.stringify(payload) }),
  feishu: () => request<{ config: { group_chat_id: string }; meta: SecretsMeta["feishu"] }>("/api/feishu"),
  saveFeishu: (payload: { app_id: string; app_secret: string; group_chat_id: string }) => request("/api/feishu", { method: "PUT", body: JSON.stringify(payload) }),
  testFeishu: () => request("/api/feishu/test", { method: "POST" }),
  control: (target: "crawl" | "agent", action: "pause" | "resume") => request(`/api/control/${target}/${action}`, { method: "POST" }),
};
