from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel


router = APIRouter(prefix="/api/repos", tags=["repos"])


class StatusPayload(BaseModel):
    status: str


class CleanupPayload(BaseModel):
    mode: str
    date: str | None = None


def get_state(request: Request):
    return request.app.state.app_state


@router.get("")
async def list_repos(
    repo_query: str = "", language: str = "", strategy_id: str = "", status: list[str] | None = Query(None),
    stars_min: int | None = None, stars_max: int | None = None, date_from: str = "", date_to: str = "",
    page: int = 1, page_size: int = 20, app_state=Depends(get_state),
):
    items, total = await app_state.db.list_repos(
        repo_query=repo_query.strip(), language=language.strip(), strategy_id=strategy_id.strip(), statuses=status,
        stars_min=stars_min, stars_max=stars_max, date_from=date_from.strip(), date_to=date_to.strip(), page=page, page_size=page_size,
    )
    return {"items": items, "pagination": {"page": max(page, 1), "page_size": max(min(page_size, 100), 1), "total": total}, "languages": await app_state.db.list_languages()}


@router.put("/{repo_id}/status")
async def update_status(repo_id: int, payload: StatusPayload, app_state=Depends(get_state)):
    try:
        updated = await app_state.db.update_repo_status(repo_id, payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    if not updated:
        raise HTTPException(status_code=404, detail={"message": "仓库不存在"})
    await app_state.record_event("repo", "status_updated", "success", f"仓库状态已更新为 {payload.status}", repo_id=repo_id)
    return updated


@router.post("/cleanup")
async def cleanup(payload: CleanupPayload, app_state=Depends(get_state)):
    if payload.mode not in {"fetched_before", "ignored"}:
        raise HTTPException(status_code=400, detail={"message": "不支持的归档模式"})
    if payload.mode == "fetched_before":
        if not payload.date:
            raise HTTPException(status_code=400, detail={"message": "请提供归档日期"})
        try:
            datetime.fromisoformat(payload.date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"message": "日期格式必须为 YYYY-MM-DD"}) from exc
    count = await app_state.db.archive_repositories(mode=payload.mode, date=payload.date)
    await app_state.record_event("repo", "cleanup", "success", f"已归档 {count} 条仓库", payload={"mode": payload.mode, "date": payload.date})
    return {"archived_count": count}
