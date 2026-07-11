import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AppConfig, Repo, RepoStatus, SecretsMeta, StatusResponse, Strategy } from "./types";

type Tab = "repos" | "status" | "settings";

const statusLabels: Record<RepoStatus, string> = {
  queued: "待介绍",
  analyzing: "介绍中",
  analyzed: "已介绍",
  failed: "失败",
  ignored: "已忽略",
  archived: "已归档",
};

function formatDate(value: string): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function emptyStrategy(): Strategy {
  return { id: `strategy-${Date.now()}`, name: "新策略组", enabled: false, query: "", stars_min: 10, stars_max: 500, max_pages: 8, pages_per_run: 1, per_run_target: 8 };
}

function RepoCard({ repo, onStatus }: { repo: Repo; onStatus: (status: RepoStatus) => void }) {
  const [expanded, setExpanded] = useState(false);
  const analysis = repo.analysis;
  return (
    <article className="repo-card">
      <div className="repo-card__header">
        <div>
          <a className="repo-name" href={repo.html_url} target="_blank" rel="noreferrer">{repo.full_name}</a>
          <p>{repo.description || "仓库未提供简介"}</p>
        </div>
        <span className={`status status--${repo.status}`}>{statusLabels[repo.status]}</span>
      </div>
      <div className="meta"><span>{repo.language || "未标注语言"}</span><span>★ {repo.stars}</span><span>{repo.repo_license || analysis.license || "未标注协议"}</span><span>{repo.source_strategy_ids.join(" / ") || "未知来源"}</span></div>
      {repo.status === "failed" && <p className="error-text">{repo.failure_message || "AI 项目介绍失败"}</p>}
      {analysis.summary && <p className="summary">{analysis.summary}</p>}
      <div className="card-actions">
        <button className="button button--quiet" onClick={() => setExpanded(!expanded)}>{expanded ? "收起详情" : "查看详情"}</button>
        {repo.status !== "ignored" && <button className="button button--quiet" onClick={() => onStatus("ignored")}>忽略</button>}
        {repo.status !== "archived" && <button className="button button--quiet" onClick={() => onStatus("archived")}>归档</button>}
        {(repo.status === "failed" || repo.status === "ignored" || repo.status === "archived") && <button className="button" onClick={() => onStatus("queued")}>重新排队</button>}
      </div>
      {expanded && (
        <section className="brief">
          <div><h4>项目用途</h4><p>{analysis.purpose || "待生成"}</p></div>
          <div><h4>主要功能</h4><p>{analysis.features.length ? analysis.features.join("、") : "待生成"}</p></div>
          <div><h4>适用人群</h4><p>{analysis.target_users.length ? analysis.target_users.join("、") : "待生成"}</p></div>
          <div><h4>技术信息</h4><p>{analysis.tech_stack.length ? analysis.tech_stack.join("、") : "待生成"}</p></div>
          <div><h4>运行说明</h4><p>{analysis.deployment_notes || "待生成"}</p></div>
          <div><h4>证据来源</h4><p>{analysis.evidence.length ? analysis.evidence.join("、") : "待生成"}</p></div>
        </section>
      )}
    </article>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("repos");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [strategyId, setStrategyId] = useState("");
  const [statuses, setStatuses] = useState<RepoStatus[]>(["queued", "analyzing", "analyzed", "failed", "ignored"]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [secrets, setSecrets] = useState<SecretsMeta | null>(null);
  const [githubToken, setGithubToken] = useState("");
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [feishuForm, setFeishuForm] = useState({ app_id: "", app_secret: "", group_chat_id: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const enabledStrategies = useMemo(() => config?.search.strategies.filter((item) => item.enabled) ?? [], [config]);

  async function loadRepos(nextPage = page) {
    const response = await api.repos({ repo_query: query, language, strategy_id: strategyId, status: statuses, page: nextPage, page_size: 20 });
    setRepos(response.items);
    setLanguages(response.languages);
    setTotal(response.pagination.total);
    setPage(response.pagination.page);
  }

  async function loadAll() {
    setBusy(true);
    setError("");
    try {
      const [nextConfig, nextStatus, nextSecrets] = await Promise.all([api.config(), api.status(), api.secrets()]);
      setConfig(nextConfig);
      setStatus(nextStatus);
      setSecrets(nextSecrets);
      setFeishuForm((form) => ({ ...form, group_chat_id: nextConfig.feishu.group_chat_id }));
      await loadRepos(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载数据失败");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  async function withFeedback(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setMessage(success);
      await loadAll();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  function updateConfig(mutator: (current: AppConfig) => AppConfig) {
    setConfig((current) => current ? mutator(current) : current);
  }

  async function saveSettings() {
    if (!config) return;
    await withFeedback(async () => {
      await api.saveConfig({ search: config.search, agent: config.agent, providers: config.providers, notify: config.notify });
      await api.saveSecrets({ github_token: githubToken, providers: providerKeys, replace_providers: true });
    }, "采集和 AI 配置已保存");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><strong>RepoRadar</strong><span>GitHub 仓库发现与项目介绍</span></div>
        <div className="topbar-actions">
          <nav>{(["repos", "status", "settings"] as Tab[]).map((item) => <button key={item} className={tab === item ? "nav-active" : ""} onClick={() => setTab(item)}>{item === "repos" ? "仓库" : item === "status" ? "运行状态" : "设置"}</button>)}</nav>
          <a className="github-link" href="https://github.com/dnwwdwd/repo-radar" target="_blank" rel="noreferrer" aria-label="打开 RepoRadar GitHub 仓库" title="GitHub 仓库">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.73c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" /></svg>
          </a>
        </div>
      </header>
      {(message || error) && <div className={error ? "notice notice--error" : "notice"}>{error || message}<button onClick={() => { setMessage(""); setError(""); }}>×</button></div>}

      {tab === "repos" && <section className="page">
        <div className="page-heading"><div><h1>发现的仓库</h1><p>按策略组持续收集 GitHub 新项目，并生成中文项目介绍。</p></div><button className="button" disabled={busy} onClick={() => void withFeedback(() => loadRepos(1), "仓库列表已刷新")}>刷新列表</button></div>
        <div className="filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索仓库名称或简介" />
          <select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="">全部语言</option>{languages.map((item) => <option key={item}>{item}</option>)}</select>
          <select value={strategyId} onChange={(event) => setStrategyId(event.target.value)}><option value="">全部策略组</option>{config?.search.strategies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <button className="button" onClick={() => void withFeedback(() => loadRepos(1), "筛选已更新")}>应用筛选</button>
        </div>
        <div className="status-filters">{(Object.keys(statusLabels) as RepoStatus[]).map((item) => <label key={item}><input type="checkbox" checked={statuses.includes(item)} onChange={(event) => setStatuses((current) => event.target.checked ? [...current, item] : current.filter((value) => value !== item))} /> {statusLabels[item]}</label>)}</div>
        <p className="result-count">共 {total} 条仓库，当前启用 {enabledStrategies.length} 个策略组。</p>
        <div className="repo-grid">{repos.map((repo) => <RepoCard key={repo.id} repo={repo} onStatus={(next) => void withFeedback(async () => { await api.updateRepoStatus(repo.id, next); }, "仓库状态已更新")} />)}</div>
        {!busy && !repos.length && <div className="empty">还没有仓库记录。请到设置页启用至少一个策略组。</div>}
        {total > 20 && <div className="pager"><button className="button button--quiet" disabled={page <= 1} onClick={() => void withFeedback(() => loadRepos(page - 1), "已切换上一页")}>上一页</button><span>第 {page} 页</span><button className="button button--quiet" disabled={page * 20 >= total} onClick={() => void withFeedback(() => loadRepos(page + 1), "已切换下一页")}>下一页</button></div>}
      </section>}

      {tab === "status" && <section className="page">
        <div className="page-heading"><div><h1>运行状态</h1><p>查看采集、AI 项目介绍和飞书群聊通知的运行情况。</p></div><button className="button" disabled={busy} onClick={() => void loadAll()}>刷新状态</button></div>
        {status && <>
          <div className="stat-grid">
            <div className="stat"><span>GitHub</span><strong>{status.github.state}</strong><small>{status.github.message}</small></div>
            <div className="stat"><span>待介绍</span><strong>{status.queues.queued}</strong><small>分析中的仓库：{status.queues.analyzing}</small></div>
            <div className="stat"><span>AI Provider</span><strong>{status.agent.active_provider || "未启用"}</strong><small>{status.agent.provider_configured ? "密钥已配置" : "密钥未配置"}</small></div>
            <div className="stat"><span>飞书群聊</span><strong>{status.feishu.group_chat_configured ? "已配置" : "未配置"}</strong><small>{status.feishu.group_chat_id_masked || "请在设置页填写"}</small></div>
          </div>
          <div className="panel-grid">
            <section className="panel"><h2>任务控制</h2>{(["crawl", "agent"] as const).map((target) => <div className="control-row" key={target}><div><strong>{target === "crawl" ? "GitHub 采集" : "AI 项目介绍"}</strong><span>{status.controls[target].running ? "正在运行" : status.controls[target].enabled ? "等待下一次执行" : "已暂停"}</span></div><button className="button button--quiet" onClick={() => void withFeedback(async () => { await api.control(target, status.controls[target].enabled ? "pause" : "resume"); }, "任务状态已更新")}>{status.controls[target].enabled ? "暂停" : "恢复并执行"}</button></div>)}</section>
            <section className="panel"><h2>调度任务</h2>{status.tasks.map((task) => <div className="task-row" key={task.id}><strong>{task.name}</strong><span>{task.next_run}</span></div>)}</section>
          </div>
          <section className="panel"><h2>最近事件</h2>{status.runtime_events.length ? status.runtime_events.map((event) => <div className="event-row" key={event.id}><span>{formatDate(event.created_at)}</span><strong>{event.summary}</strong><em>{event.status}</em></div>) : <p>暂无运行事件。</p>}</section>
        </>}
      </section>}

      {tab === "settings" && <section className="page">
        <div className="page-heading"><div><h1>设置</h1><p>配置策略组、AI Provider、飞书群聊和运行节奏。密钥只会写入本机数据目录。</p></div><button className="button" disabled={busy} onClick={() => void saveSettings()}>保存采集与 AI 配置</button></div>
        {config && <>
          <section className="panel"><h2>采集策略组</h2><div className="form-row compact"><label>采集频率<input value={config.search.cron} onChange={(event) => updateConfig((item) => ({ ...item, search: { ...item.search, cron: event.target.value } }))} /></label><label>冷却天数<input type="number" value={config.search.seen_cooldown_days} onChange={(event) => updateConfig((item) => ({ ...item, search: { ...item.search, seen_cooldown_days: Number(event.target.value) } }))} /></label><label>每轮新仓库上限<input type="number" value={config.search.max_new_repos_per_tick} onChange={(event) => updateConfig((item) => ({ ...item, search: { ...item.search, max_new_repos_per_tick: Number(event.target.value) } }))} /></label></div>
            {config.search.strategies.map((strategy, index) => <div className="strategy" key={strategy.id}><div className="strategy-title"><input type="checkbox" checked={strategy.enabled} onChange={(event) => updateConfig((item) => ({ ...item, search: { ...item.search, strategies: item.search.strategies.map((value, position) => position === index ? { ...value, enabled: event.target.checked } : value) } }))} /><input value={strategy.name} onChange={(event) => updateConfig((item) => ({ ...item, search: { ...item.search, strategies: item.search.strategies.map((value, position) => position === index ? { ...value, name: event.target.value } : value) } }))} /><button className="text-button" onClick={() => updateConfig((item) => ({ ...item, search: { ...item.search, strategies: item.search.strategies.filter((_, position) => position !== index) } }))}>删除</button></div><input className="wide" value={strategy.query} placeholder="GitHub Search Query" onChange={(event) => updateConfig((item) => ({ ...item, search: { ...item.search, strategies: item.search.strategies.map((value, position) => position === index ? { ...value, query: event.target.value } : value) } }))} /><div className="form-row compact"><label>最低 Stars<input type="number" value={strategy.stars_min} onChange={(event) => updateConfig((item) => ({ ...item, search: { ...item.search, strategies: item.search.strategies.map((value, position) => position === index ? { ...value, stars_min: Number(event.target.value) } : value) } }))} /></label><label>最高 Stars<input type="number" value={strategy.stars_max} onChange={(event) => updateConfig((item) => ({ ...item, search: { ...item.search, strategies: item.search.strategies.map((value, position) => position === index ? { ...value, stars_max: Number(event.target.value) } : value) } }))} /></label><label>每轮页数<input type="number" value={strategy.pages_per_run} onChange={(event) => updateConfig((item) => ({ ...item, search: { ...item.search, strategies: item.search.strategies.map((value, position) => position === index ? { ...value, pages_per_run: Number(event.target.value) } : value) } }))} /></label></div></div>)}
            <button className="button button--quiet" onClick={() => updateConfig((item) => ({ ...item, search: { ...item.search, strategies: [...item.search.strategies, emptyStrategy()] } }))}>添加策略组</button>
            <button className="text-button" onClick={() => void withFeedback(async () => { await api.resetCrawlState(false); }, "采集游标已重置")}>重置采集游标</button>
          </section>
          <section className="panel"><h2>AI Provider 与分析任务</h2><div className="form-row compact"><label>分析频率<input value={config.agent.cron} onChange={(event) => updateConfig((item) => ({ ...item, agent: { ...item.agent, cron: event.target.value } }))} /></label><label>每轮数量<input type="number" value={config.agent.batch_size} onChange={(event) => updateConfig((item) => ({ ...item, agent: { ...item.agent, batch_size: Number(event.target.value) } }))} /></label><label>最大文件读取轮数<input type="number" value={config.agent.max_turns} onChange={(event) => updateConfig((item) => ({ ...item, agent: { ...item.agent, max_turns: Number(event.target.value) } }))} /></label></div>
            {config.providers.map((provider, index) => <div className="provider" key={provider.name}><div><input type="radio" checked={provider.active} onChange={() => updateConfig((item) => ({ ...item, providers: item.providers.map((value, position) => ({ ...value, active: position === index })) }))} /> 启用</div><label>名称<input value={provider.name} onChange={(event) => updateConfig((item) => ({ ...item, providers: item.providers.map((value, position) => position === index ? { ...value, name: event.target.value } : value) }))} /></label><label>Base URL<input value={provider.base_url} onChange={(event) => updateConfig((item) => ({ ...item, providers: item.providers.map((value, position) => position === index ? { ...value, base_url: event.target.value } : value) }))} /></label><label>模型<input value={provider.model} onChange={(event) => updateConfig((item) => ({ ...item, providers: item.providers.map((value, position) => position === index ? { ...value, model: event.target.value } : value) }))} /></label><label>API Key<input type="password" value={providerKeys[provider.name] ?? ""} placeholder={secrets?.providers[provider.name]?.masked || "输入后保存"} onChange={(event) => setProviderKeys((value) => ({ ...value, [provider.name]: event.target.value }))} /></label></div>)}
            <button className="button button--quiet" onClick={() => updateConfig((item) => ({ ...item, providers: [...item.providers, { name: `provider-${item.providers.length + 1}`, base_url: "https://api.example.com/v1", model: "", active: item.providers.length === 0 }] }))}>添加 Provider</button>
            <div className="provider"><label>GitHub Token<input type="password" value={githubToken} placeholder={secrets?.github_token.masked || "输入后保存"} onChange={(event) => setGithubToken(event.target.value)} /></label></div>
          </section>
          <section className="panel"><h2>飞书群聊通知</h2><div className="form-row"><label>App ID<input value={feishuForm.app_id} onChange={(event) => setFeishuForm((value) => ({ ...value, app_id: event.target.value }))} /></label><label>App Secret<input type="password" value={feishuForm.app_secret} onChange={(event) => setFeishuForm((value) => ({ ...value, app_secret: event.target.value }))} /></label><label>群会话 chat_id<input value={feishuForm.group_chat_id} onChange={(event) => setFeishuForm((value) => ({ ...value, group_chat_id: event.target.value }))} /></label></div><div className="card-actions"><button className="button" onClick={() => void withFeedback(async () => { await api.saveFeishu(feishuForm); }, "飞书群聊配置已保存")}>保存飞书配置</button><button className="button button--quiet" onClick={() => void withFeedback(async () => { await api.testFeishu(); }, "飞书测试消息已发送")}>发送测试消息</button></div><div className="form-row compact"><label><input type="checkbox" checked={config.notify.instant_enabled} onChange={(event) => updateConfig((item) => ({ ...item, notify: { ...item.notify, instant_enabled: event.target.checked } }))} /> 分析完成后即时通知</label><label><input type="checkbox" checked={config.notify.daily_digest_enabled} onChange={(event) => updateConfig((item) => ({ ...item, notify: { ...item.notify, daily_digest_enabled: event.target.checked } }))} /> 每日摘要</label><label>摘要 Cron<input value={config.notify.daily_digest_crons[0] || ""} onChange={(event) => updateConfig((item) => ({ ...item, notify: { ...item.notify, daily_digest_crons: [event.target.value] } }))} /></label></div></section>
          <section className="panel danger"><h2>归档</h2><p>已忽略仓库可批量归档，归档记录仍保留在数据库中，避免重复入库。</p><button className="button button--quiet" onClick={() => void withFeedback(async () => { await api.cleanup("ignored"); }, "已忽略仓库已归档")}>归档已忽略仓库</button></section>
        </>}
      </section>}
    </main>
  );
}
