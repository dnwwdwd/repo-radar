from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel


router = APIRouter(prefix="/api/feishu", tags=["feishu"])


class FeishuConfigPayload(BaseModel):
    app_id: str = ""
    app_secret: str = ""
    group_chat_id: str = ""


def get_state(request: Request):
    return request.app.state.app_state


@router.get("")
async def get_feishu(app_state=Depends(get_state)):
    config = app_state.config_store.get()
    meta = app_state.secrets_store.read_meta([item.name for item in config.providers], config.feishu.group_chat_id)
    return {"config": config.feishu.model_dump(), "meta": meta["feishu"]}


@router.put("")
async def save_feishu(payload: FeishuConfigPayload, app_state=Depends(get_state)):
    if not payload.group_chat_id.strip():
        raise HTTPException(status_code=400, detail={"message": "请填写飞书群会话 chat_id"})
    current = app_state.secrets_store.read_raw().get("feishu", {})
    app_id = payload.app_id.strip() or str(current.get("app_id", ""))
    app_secret = payload.app_secret.strip() or str(current.get("app_secret", ""))
    if not app_id or not app_secret:
        raise HTTPException(status_code=400, detail={"message": "请填写飞书 App ID 和 App Secret"})
    app_state.config_store.save({"feishu": {"group_chat_id": payload.group_chat_id.strip()}})
    app_state.secrets_store.save({"feishu": {"app_id": app_id, "app_secret": app_secret}})
    await app_state.record_event("feishu", "config_saved", "success", "飞书群聊配置已保存")
    return await get_feishu(app_state)


@router.post("/test")
async def send_test(app_state=Depends(get_state)):
    try:
        result = await app_state.notifier.send_test(config=app_state.config_store.get(), secrets=app_state.secrets_store.read_raw())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"message": str(exc)}) from exc
    await app_state.record_event("feishu", "test_sent", "success", "飞书测试消息已发送")
    return result
