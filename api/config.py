from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.scheduler import register_jobs


router = APIRouter(prefix="/api/config", tags=["config"])


class ResetCrawlStatePayload(BaseModel):
    clear_seen: bool = False


def get_state(request: Request):
    return request.app.state.app_state


@router.get("")
async def get_config(app_state=Depends(get_state)):
    return app_state.config_store.get().model_dump()


@router.put("")
async def update_config(payload: dict, app_state=Depends(get_state)):
    try:
        config = app_state.config_store.save(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    register_jobs(app_state.scheduler, config, app_state)
    await app_state.record_event("config", "saved", "success", "配置已保存并重新加载")
    return {"config": config.model_dump(), "reloaded": True}


@router.get("/crawl-state")
async def get_crawl_state(app_state=Depends(get_state)):
    return {"states": await app_state.db.list_strategy_states(), "seen_count": await app_state.db.count_crawl_seen()}


@router.post("/crawl-state/reset")
async def reset_crawl_state(payload: ResetCrawlStatePayload, app_state=Depends(get_state)):
    deleted_states = await app_state.db.clear_strategy_states()
    deleted_seen = await app_state.db.clear_crawl_seen() if payload.clear_seen else 0
    await app_state.record_event("config", "crawl_state_reset", "success", "采集游标已重置", payload={"clear_seen": payload.clear_seen})
    return {"deleted_states": deleted_states, "deleted_seen": deleted_seen}
