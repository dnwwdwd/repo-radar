from __future__ import annotations

from fastapi import APIRouter, Depends, Request


router = APIRouter(prefix="/api/logs", tags=["logs"])


def get_state(request: Request):
    return request.app.state.app_state


@router.get("")
async def list_logs(limit: int = 100, category: str = "", app_state=Depends(get_state)):
    return {"items": await app_state.db.list_events(limit=max(1, min(limit, 200)), category=category.strip())}
