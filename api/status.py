from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from core.scheduler import describe_jobs


router = APIRouter(prefix="/api/status", tags=["status"])


def get_state(request: Request):
    return request.app.state.app_state


@router.get("")
async def get_status(app_state=Depends(get_state)):
    config = app_state.config_store.get()
    active = next((item for item in config.providers if item.active), None)
    secrets = app_state.secrets_store.read_meta([item.name for item in config.providers], config.feishu.group_chat_id)
    return {
        "service": {"status": "running", "scheduler_running": bool(getattr(app_state.scheduler, "running", False))},
        "github": app_state.github.get_token_status().__dict__,
        "queues": await app_state.db.get_queue_counts(),
        "agent": {"active_provider": active.name if active else "", "provider_configured": bool(secrets["providers"].get(active.name if active else "", {}).get("configured"))},
        "feishu": secrets["feishu"],
        "controls": app_state.get_controls_status(),
        "tasks": describe_jobs(app_state.scheduler),
        "runtime_events": await app_state.db.list_events(limit=12),
    }
