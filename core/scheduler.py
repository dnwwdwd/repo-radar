from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from core.config import AppConfig
from core.time import SHANGHAI_TIMEZONE


def build_scheduler() -> AsyncIOScheduler:
    return AsyncIOScheduler(timezone=SHANGHAI_TIMEZONE)


def register_jobs(scheduler: AsyncIOScheduler, config: AppConfig, state: object) -> None:
    for job in scheduler.get_jobs():
        scheduler.remove_job(job.id)
    scheduler.add_job(state.run_crawl_job, CronTrigger.from_crontab(config.search.cron, timezone=SHANGHAI_TIMEZONE), id="crawl", replace_existing=True, max_instances=1, misfire_grace_time=60)
    scheduler.add_job(state.run_agent_job, CronTrigger.from_crontab(config.agent.cron, timezone=SHANGHAI_TIMEZONE), id="agent", replace_existing=True, max_instances=1, misfire_grace_time=60)
    for index, cron in enumerate(config.notify.daily_digest_crons):
        scheduler.add_job(state.run_digest_job, CronTrigger.from_crontab(cron, timezone=SHANGHAI_TIMEZONE), id=f"digest-{index}", replace_existing=True, max_instances=1, misfire_grace_time=60)
    if not config.control.crawl_enabled:
        scheduler.pause_job("crawl")
    if not config.control.agent_enabled:
        scheduler.pause_job("agent")


def describe_jobs(scheduler: AsyncIOScheduler) -> list[dict[str, str]]:
    labels = {"crawl": "GitHub 采集", "agent": "AI 项目介绍"}
    return [
        {
            "id": job.id,
            "name": labels.get(job.id, "飞书每日摘要"),
            "status": "paused" if getattr(job, "next_run_time", None) is None else "waiting",
            "next_run": job.next_run_time.isoformat() if getattr(job, "next_run_time", None) else "未调度",
        }
        for job in scheduler.get_jobs()
    ]
