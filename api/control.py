from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Request

from core.scheduler import register_jobs


router = APIRouter(prefix="/api/control", tags=["control"])


def get_state(request: Request):
    return request.app.state.app_state


async def _set_control(app_state, target: str, enabled: bool) -> dict:
    field = "crawl_enabled" if target == "crawl" else "agent_enabled"
    config = app_state.config_store.save({"control": {field: enabled}})
    register_jobs(app_state.scheduler, config, app_state)
    if enabled:
        asyncio.create_task(app_state.run_crawl_job() if target == "crawl" else app_state.run_agent_job())
    await app_state.record_event("control", f"{target}_{'resumed' if enabled else 'paused'}", "success", f"{'恢复' if enabled else '暂停'}{ 'GitHub 采集' if target == 'crawl' else 'AI 项目介绍'}")
    return app_state.get_controls_status()


@router.post("/crawl/pause")
async def pause_crawl(app_state=Depends(get_state)):
    return await _set_control(app_state, "crawl", False)


@router.post("/crawl/resume")
async def resume_crawl(app_state=Depends(get_state)):
    return await _set_control(app_state, "crawl", True)


@router.post("/agent/pause")
async def pause_agent(app_state=Depends(get_state)):
    return await _set_control(app_state, "agent", False)


@router.post("/agent/resume")
async def resume_agent(app_state=Depends(get_state)):
    return await _set_control(app_state, "agent", True)
