from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx


def _repo_url(repo: dict[str, Any]) -> str:
    return str(repo.get("html_url") or f"https://github.com/{repo['full_name']}")


class FeishuNotifier:
    def is_ready(self, *, config: Any, secrets: dict[str, Any]) -> tuple[bool, str]:
        feishu = secrets.get("feishu", {})
        if not feishu.get("app_id") or not feishu.get("app_secret"):
            return False, "飞书 App ID 或 App Secret 未配置"
        if not str(config.feishu.group_chat_id or "").strip():
            return False, "飞书群会话 chat_id 未配置"
        return True, ""

    def _instant_card(self, repo: dict[str, Any]) -> dict[str, Any]:
        analysis = repo.get("analysis", {})
        features = analysis.get("features", [])
        return {
            "config": {"wide_screen_mode": True, "enable_forward": True},
            "header": {"template": "blue", "title": {"tag": "plain_text", "content": "RepoRadar 新项目介绍"}},
            "elements": [
                {"tag": "div", "fields": [
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**仓库**\n[{repo['full_name']}]({_repo_url(repo)})"}},
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**语言**\n{repo.get('language') or '-'}"}},
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**Stars**\n{repo.get('stars', 0)}"}},
                    {"is_short": True, "text": {"tag": "lark_md", "content": f"**协议**\n{analysis.get('license') or repo.get('repo_license') or '-'}"}},
                ]},
                {"tag": "hr"},
                {"tag": "markdown", "content": f"**摘要**\n{analysis.get('summary') or '未知'}"},
                {"tag": "markdown", "content": f"**主要功能**\n{'、'.join(features) if features else '未知'}"},
            ],
        }

    def _digest_card(self, repos: list[dict[str, Any]], day: str) -> dict[str, Any]:
        lines = [
            f"- [{repo['full_name']}]({_repo_url(repo)}) · {repo.get('language') or '-'} · {repo.get('stars', 0)} Stars\n  {repo.get('analysis', {}).get('summary') or '未知'}"
            for repo in repos
        ]
        return {
            "config": {"wide_screen_mode": True, "enable_forward": True},
            "header": {"template": "green", "title": {"tag": "plain_text", "content": f"RepoRadar 每日项目汇总 · {day}"}},
            "elements": [{"tag": "markdown", "content": "\n".join(lines) or "当天没有新的项目介绍"}],
        }

    async def _tenant_token(self, secrets: dict[str, Any]) -> str:
        feishu = secrets.get("feishu", {})
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": feishu.get("app_id", ""), "app_secret": feishu.get("app_secret", "")},
            )
        payload = response.json()
        if response.status_code >= 400 or payload.get("code", 0) != 0 or not payload.get("tenant_access_token"):
            raise ValueError(payload.get("msg") or "获取飞书 tenant token 失败")
        return str(payload["tenant_access_token"])

    async def _send_card(self, *, config: Any, secrets: dict[str, Any], card: dict[str, Any]) -> dict[str, Any]:
        ready, message = self.is_ready(config=config, secrets=secrets)
        if not ready:
            raise ValueError(message)
        token = await self._tenant_token(secrets)
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://open.feishu.cn/open-apis/im/v1/messages",
                params={"receive_id_type": "chat_id"},
                headers={"Authorization": f"Bearer {token}"},
                json={"receive_id": config.feishu.group_chat_id, "msg_type": "interactive", "content": json.dumps(card, ensure_ascii=False)},
            )
        payload = response.json()
        if response.status_code >= 400 or payload.get("code", 0) != 0:
            raise ValueError(payload.get("msg") or "飞书群消息发送失败")
        return {"sent": True, "message_id": str((payload.get("data") or {}).get("message_id") or "")}

    async def send_instant(self, *, config: Any, secrets: dict[str, Any], repo: dict[str, Any]) -> dict[str, Any]:
        if not config.notify.instant_enabled:
            return {"sent": False, "reason": "即时通知已关闭"}
        return await self._send_card(config=config, secrets=secrets, card=self._instant_card(repo))

    async def send_digest(self, *, config: Any, secrets: dict[str, Any], repos: list[dict[str, Any]], day: str) -> dict[str, Any]:
        if not config.notify.daily_digest_enabled:
            return {"sent": False, "reason": "每日摘要已关闭"}
        return await self._send_card(config=config, secrets=secrets, card=self._digest_card(repos, day))

    async def send_test(self, *, config: Any, secrets: dict[str, Any]) -> dict[str, Any]:
        card = {
            "header": {"template": "wathet", "title": {"tag": "plain_text", "content": "RepoRadar 飞书测试"}},
            "elements": [{"tag": "markdown", "content": f"测试发送时间：{datetime.now(UTC).isoformat()}"}],
        }
        return await self._send_card(config=config, secrets=secrets, card=card)
