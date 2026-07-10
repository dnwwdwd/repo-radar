from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from agent.runner import AgentRunner
from api.config import router as config_router
from api.control import router as control_router
from api.feishu import router as feishu_router
from api.logs import router as logs_router
from api.repos import router as repos_router
from api.secrets import router as secrets_router
from api.status import router as status_router
from core.config import ConfigStore
from core.crawl import CrawlCounters, advance_window, build_search_query, cooldown_until, initialize_window, should_skip_seen, strategy_signature
from core.db import Database
from core.github_client import GitHubClient, GitHubClientError
from core.scheduler import build_scheduler, register_jobs
from core.secrets import SecretsStore
from core.time import shanghai_day
from notifier.feishu import FeishuNotifier


ROOT = Path(__file__).resolve().parent


@dataclass
class AppState:
    config_store: ConfigStore
    secrets_store: SecretsStore
    db: Database
    scheduler: Any
    github: GitHubClient
    agent: AgentRunner
    notifier: FeishuNotifier

    def __post_init__(self) -> None:
        self._crawl_lock = asyncio.Lock()
        self._agent_lock = asyncio.Lock()
        self._crawl_running = False
        self._agent_running = False

    def sync_github_token(self) -> None:
        self.github.set_token(str(self.secrets_store.read_raw().get("github_token", "")))

    def active_provider(self) -> dict[str, Any] | None:
        provider = next((item for item in self.config_store.get().providers if item.active), None)
        return provider.model_dump() if provider else None

    def provider_secret(self, provider_name: str) -> str:
        return str(self.secrets_store.read_raw().get("providers", {}).get(provider_name, "") or "")

    def get_controls_status(self) -> dict[str, dict[str, bool]]:
        config = self.config_store.get()
        return {
            "crawl": {"enabled": config.control.crawl_enabled, "running": self._crawl_running},
            "agent": {"enabled": config.control.agent_enabled, "running": self._agent_running},
        }

    async def record_event(self, category: str, event_type: str, status: str, summary: str, *, payload: dict[str, Any] | None = None, repo_id: int | None = None) -> None:
        await self.db.record_event(
            category=category,
            event_type=event_type,
            status=status,
            summary=summary,
            payload=payload,
            repo_id=repo_id,
            created_at=datetime.now(UTC).isoformat(),
        )

    async def run_crawl_job(self) -> dict[str, Any]:
        config = self.config_store.get()
        if not config.control.crawl_enabled:
            return {"skipped": True, "reason": "paused"}
        if self._crawl_lock.locked():
            return {"skipped": True, "reason": "already_running"}
        enabled = [item for item in config.search.strategies if item.enabled]
        if not enabled:
            await self.record_event("crawl", "job_skipped", "skipped", "没有启用的采集策略组")
            return {"skipped": True, "reason": "no_enabled_strategy"}
        self.sync_github_token()
        aggregate = CrawlCounters()
        details: list[dict[str, Any]] = []
        async with self._crawl_lock:
            self._crawl_running = True
            try:
                for strategy in enabled[:config.search.max_strategy_runs_per_tick]:
                    if aggregate.saved_new >= config.search.max_new_repos_per_tick:
                        break
                    now = datetime.now(UTC)
                    signature = strategy_signature(config.search, strategy)
                    state = await self.db.get_strategy_state(strategy.id)
                    if not state or state["signature"] != signature:
                        window_start, window_end = initialize_window(now=now, days=config.search.created_window_days)
                        page = 1
                    else:
                        window_start, window_end = state["window_start"], state["window_end"]
                        page = max(int(state["next_page"]), 1)
                    counter = CrawlCounters()
                    scanned = 0
                    extra_pages = 0
                    exhausted = False
                    while scanned < strategy.pages_per_run + extra_pages:
                        if counter.saved_new >= strategy.per_run_target or aggregate.saved_new >= config.search.max_new_repos_per_tick:
                            break
                        query = build_search_query(config.search, strategy, window_start=window_start, window_end=window_end)
                        repos = await self.github.search_repositories(query, page=page)
                        scanned += 1
                        counter.fetched += len(repos)
                        aggregate.fetched += len(repos)
                        if not repos:
                            exhausted = True
                            page = 1
                            break
                        page_seen = 0
                        for repo in repos:
                            if counter.saved_new >= strategy.per_run_target or aggregate.saved_new >= config.search.max_new_repos_per_tick:
                                break
                            seen = await self.db.get_crawl_seen(repo["github_repo_id"])
                            if seen and should_skip_seen(seen.get("cooldown_until"), now=now):
                                counter.skipped_seen += 1
                                aggregate.skipped_seen += 1
                                page_seen += 1
                                continue
                            saved, inserted = await self.db.upsert_repo(repo, strategy_id=strategy.id)
                            await self.db.upsert_crawl_seen(
                                github_repo_id=repo["github_repo_id"], seen_at=now.isoformat(),
                                cooldown_until=cooldown_until(now=now, days=config.search.seen_cooldown_days),
                                strategy_id=strategy.id, decision="saved_new" if inserted else "saved_existing",
                            )
                            if inserted:
                                counter.saved_new += 1
                                aggregate.saved_new += 1
                                await self.record_event("crawl", "repo_discovered", "success", f"新仓库已入库：{saved['full_name']}", repo_id=saved["id"], payload={"strategy_id": strategy.id})
                            else:
                                counter.saved_existing += 1
                                aggregate.saved_existing += 1
                        cooldown_ratio = page_seen / len(repos)
                        if scanned >= strategy.pages_per_run and cooldown_ratio >= config.search.cooldown_skip_page_threshold and page < strategy.max_pages and extra_pages < config.search.max_cooldown_extra_pages_per_strategy:
                            extra_pages += 1
                        if len(repos) < 100 or page >= strategy.max_pages:
                            exhausted = True
                            page = 1
                            break
                        page += 1
                    next_start, next_end = (advance_window(now=now, current_start=window_start, days=config.search.created_window_days, lookback_days=config.search.created_lookback_days) if exhausted else (window_start, window_end))
                    await self.db.upsert_strategy_state(strategy_id=strategy.id, signature=signature, next_page=page, window_start=next_start, window_end=next_end, last_run_at=now.isoformat())
                    details.append({"strategy_id": strategy.id, "window_start": window_start, "window_end": window_end, "window_advanced": exhausted, **counter.to_dict()})
                await self.record_event("crawl", "job_finished", "success", f"采集完成：新增 {aggregate.saved_new} 条，冷却跳过 {aggregate.skipped_seen} 条", payload={"strategies": details, **aggregate.to_dict()})
                return {"strategies": details, **aggregate.to_dict()}
            except GitHubClientError as exc:
                if exc.code == "github_token_invalid":
                    self.config_store.save({"control": {"crawl_enabled": False}})
                    try:
                        self.scheduler.pause_job("crawl")
                    except Exception:
                        pass
                await self.record_event("crawl", "job_failed", "failed", exc.message, payload={"code": exc.code})
                return {"error_code": exc.code, "message": exc.message, **aggregate.to_dict()}
            finally:
                self._crawl_running = False

    async def run_agent_job(self) -> dict[str, Any]:
        config = self.config_store.get()
        if not config.control.agent_enabled:
            return {"skipped": True, "reason": "paused"}
        if self._agent_lock.locked():
            return {"skipped": True, "reason": "already_running"}
        provider = self.active_provider()
        if not provider:
            await self.record_event("agent", "job_skipped", "skipped", "没有启用的 AI Provider")
            return {"skipped": True, "reason": "no_active_provider"}
        self.sync_github_token()
        processed = failed = notified = 0
        async with self._agent_lock:
            self._agent_running = True
            try:
                for _ in range(config.agent.batch_size):
                    repo = await self.db.get_pending_repo(config.agent.failure_retry_limit)
                    if not repo:
                        break
                    await self.db.mark_analyzing(repo["id"])
                    await self.record_event("agent", "analysis_started", "info", f"开始介绍仓库：{repo['full_name']}", repo_id=repo["id"])
                    try:
                        result = await self.agent.analyze_repo(repo, provider=provider, api_key=self.provider_secret(provider["name"]), github_client=self.github, max_turns=config.agent.max_turns)
                        await self.db.save_analysis(repo["id"], result, provider_name=provider["name"], model=provider["model"], analyzed_at=result["analyzed_at"])
                        processed += 1
                        analyzed = await self.db.get_repo_by_id(repo["id"])
                        await self.record_event("agent", "analysis_finished", "success", f"已生成项目介绍：{repo['full_name']}", repo_id=repo["id"])
                        key = f"{repo['id']}:v1:instant"
                        if not await self.db.has_notification(key):
                            try:
                                sent = await self.notifier.send_instant(config=config, secrets=self.secrets_store.read_raw(), repo=analyzed or repo)
                                if sent.get("sent"):
                                    await self.db.record_notification(dedupe_key=key, repo_id=repo["id"], notification_type="instant", sent_at=datetime.now(UTC).isoformat(), payload=sent)
                                    notified += 1
                            except ValueError as exc:
                                await self.record_event("feishu", "instant_failed", "failed", str(exc), repo_id=repo["id"])
                    except Exception as exc:
                        failed += 1
                        await self.db.mark_failed(repo["id"], str(exc))
                        await self.record_event("agent", "analysis_failed", "failed", f"项目介绍失败：{exc}", repo_id=repo["id"])
                return {"processed": processed, "failed": failed, "instant_notified": notified}
            finally:
                self._agent_running = False

    async def run_digest_job(self) -> dict[str, Any]:
        config = self.config_store.get()
        day = shanghai_day()
        repos = await self.db.get_digest_repos(day)
        if not repos:
            return {"sent": False, "reason": "empty"}
        key = f"digest:{day}"
        if await self.db.has_notification(key):
            return {"sent": False, "reason": "duplicate"}
        try:
            result = await self.notifier.send_digest(config=config, secrets=self.secrets_store.read_raw(), repos=repos, day=day)
            if result.get("sent"):
                await self.db.record_notification(dedupe_key=key, repo_id=repos[0]["id"], notification_type="digest", sent_at=datetime.now(UTC).isoformat(), payload=result)
                await self.record_event("feishu", "digest_sent", "success", f"每日摘要已发送：{len(repos)} 条")
            return result
        except ValueError as exc:
            await self.record_event("feishu", "digest_failed", "failed", str(exc))
            return {"sent": False, "reason": str(exc)}


def create_app(root_path: Path | None = None) -> FastAPI:
    root = root_path or ROOT
    data_dir = Path(os.getenv("REPO_RADAR_DATA_DIR", str(root / "data")))
    config_store = ConfigStore(data_dir / "config.yml", root / "config.example.yml")
    secrets_store = SecretsStore(data_dir / "secrets.json")
    state = AppState(
        config_store=config_store,
        secrets_store=secrets_store,
        db=Database(data_dir / "repo-radar.db"),
        scheduler=build_scheduler(),
        github=GitHubClient(str(secrets_store.read_raw().get("github_token", ""))),
        agent=AgentRunner(),
        notifier=FeishuNotifier(),
    )
    app = FastAPI(title="RepoRadar", version="0.1.0")
    app.state.app_state = state
    app.add_middleware(CORSMiddleware, allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])
    app.include_router(repos_router)
    app.include_router(config_router)
    app.include_router(control_router)
    app.include_router(status_router)
    app.include_router(logs_router)
    app.include_router(secrets_router)
    app.include_router(feishu_router)

    frontend_dist = root / "frontend" / "dist"
    if frontend_dist.exists():
        app.mount("/assets", StaticFiles(directory=frontend_dist / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        async def serve_frontend() -> FileResponse:
            return FileResponse(frontend_dist / "index.html")
    else:
        @app.get("/", include_in_schema=False)
        async def root_info() -> dict[str, str]:
            return {"name": "RepoRadar", "message": "前端尚未构建"}

    @app.get("/healthz")
    async def healthcheck() -> dict[str, str]:
        return {"status": "ok"}

    @app.on_event("startup")
    async def startup() -> None:
        await state.db.init()
        register_jobs(state.scheduler, config_store.get(), state)
        if not state.scheduler.running:
            state.scheduler.start()

    @app.on_event("shutdown")
    async def shutdown() -> None:
        if state.scheduler.running:
            state.scheduler.shutdown(wait=False)

    return app


app = create_app()
