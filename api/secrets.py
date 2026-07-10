from __future__ import annotations

from fastapi import APIRouter, Depends, Request


router = APIRouter(prefix="/api/secrets", tags=["secrets"])


def get_state(request: Request):
    return request.app.state.app_state


@router.get("")
async def get_secrets(app_state=Depends(get_state)):
    config = app_state.config_store.get()
    return app_state.secrets_store.read_meta([item.name for item in config.providers], config.feishu.group_chat_id)


@router.put("")
async def update_secrets(payload: dict, app_state=Depends(get_state)):
    config = app_state.config_store.get()
    if payload.get("replace_providers"):
        providers = payload.get("providers", {})
        app_state.secrets_store.sync_provider_secrets([item.name for item in config.providers], providers if isinstance(providers, dict) else {})
    else:
        app_state.secrets_store.save(payload)
    app_state.sync_github_token()
    return app_state.secrets_store.read_meta([item.name for item in config.providers], config.feishu.group_chat_id)
