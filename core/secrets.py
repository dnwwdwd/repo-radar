from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


DEFAULT_SECRETS: dict[str, Any] = {
    "github_token": "",
    "providers": {},
    "feishu": {"app_id": "", "app_secret": ""},
}


def mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * (len(value) - 8)}{value[-4:]}"


class SecretsStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._ensure()

    def _ensure(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text(json.dumps(DEFAULT_SECRETS, ensure_ascii=False, indent=2), encoding="utf-8")

    def read_raw(self) -> dict[str, Any]:
        self._ensure()
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        payload.setdefault("providers", {})
        payload.setdefault("feishu", {})
        for target, env_name in (("github_token", "GITHUB_TOKEN"),):
            if not payload.get(target) and os.getenv(env_name):
                payload[target] = os.getenv(env_name, "").strip()
        feishu = payload["feishu"]
        if not feishu.get("app_id") and os.getenv("FEISHU_APP_ID"):
            feishu["app_id"] = os.getenv("FEISHU_APP_ID", "").strip()
        if not feishu.get("app_secret") and os.getenv("FEISHU_APP_SECRET"):
            feishu["app_secret"] = os.getenv("FEISHU_APP_SECRET", "").strip()
        return payload

    def read_meta(self, provider_names: list[str], group_chat_id: str) -> dict[str, Any]:
        raw = self.read_raw()
        provider_values = raw.get("providers", {})
        feishu = raw.get("feishu", {})
        return {
            "github_token": {"configured": bool(raw.get("github_token")), "masked": mask_secret(str(raw.get("github_token", "")))},
            "providers": {
                name: {"configured": bool(provider_values.get(name)), "masked": mask_secret(str(provider_values.get(name, "")))}
                for name in provider_names
            },
            "feishu": {
                "app_configured": bool(feishu.get("app_id") and feishu.get("app_secret")),
                "group_chat_configured": bool(group_chat_id.strip()),
                "group_chat_id_masked": mask_secret(group_chat_id.strip()),
            },
        }

    def save(self, updates: dict[str, Any]) -> dict[str, Any]:
        raw = self._deep_merge(self.read_raw(), updates)
        self.path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
        return raw

    def sync_provider_secrets(self, names: list[str], updates: dict[str, str]) -> None:
        raw = self.read_raw()
        current = raw.get("providers", {})
        raw["providers"] = {name: str(updates.get(name, current.get(name, "")) or "") for name in names}
        self.path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    def _deep_merge(self, current: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
        merged = dict(current)
        for key, value in updates.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = self._deep_merge(merged[key], value)
            else:
                merged[key] = value
        return merged
