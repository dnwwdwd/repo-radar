from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx

from agent.parser import parse_loop_response
from agent.prompts import SYSTEM_PROMPT
from agent.tools import RepoFileToolbox, build_initial_context


class AgentRunner:
    def __init__(self, timeout: float = 45.0) -> None:
        self.timeout = timeout

    async def analyze_repo(self, repo: dict[str, Any], *, provider: dict[str, Any], api_key: str, github_client: Any, max_turns: int) -> dict[str, Any]:
        if not api_key:
            raise ValueError(f"Provider {provider['name']} 未配置 API Key")
        context = await build_initial_context(repo, github_client)
        toolbox = RepoFileToolbox(repo=repo, github=github_client, tree_paths=context["tree_paths"])
        observations: list[dict[str, Any]] = []
        agent_log: list[dict[str, str]] = [{"thought": "已加载仓库公开资料", "action": "collect_context"}]
        for turn in range(max(1, max_turns)):
            payload = {
                "repo": context["repo_info"],
                "context": context,
                "tool_observations": observations,
                "tool_usage": toolbox.usage(),
                "turn": turn + 1,
                "finish_now": turn + 1 >= max_turns,
            }
            raw = await self._call_provider(provider=provider, api_key=api_key, payload=payload)
            parsed = parse_loop_response(raw)
            if parsed["type"] == "final":
                result = parsed["result"]
                result["agent_log"] = agent_log + result.get("agent_log", []) + [{"thought": "已完成项目介绍", "action": "finish"}]
                result["analyzed_at"] = datetime.now(UTC).isoformat()
                return result
            observation = await toolbox.execute(parsed["tool"], parsed["args"])
            observations.append({"tool": parsed["tool"], "args": parsed["args"], "reason": parsed["reason"], "result": observation})
            agent_log.append({"thought": parsed["reason"] or "读取仓库文件", "action": parsed["tool"]})
        raise ValueError("AI 未在限定轮次内返回项目介绍")

    async def _call_provider(self, *, provider: dict[str, Any], api_key: str, payload: dict[str, Any]) -> str:
        base_url = str(provider["base_url"]).rstrip("/")
        request_payload = {
            "model": provider["model"],
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json=request_payload,
                )
        except httpx.HTTPError as exc:
            raise ValueError(f"Provider 请求失败：{exc}") from exc
        if response.status_code >= 400:
            raise ValueError(f"Provider 返回 HTTP {response.status_code}：{response.text[:500]}")
        if "data:" in response.text:
            parts = []
            for line in response.text.splitlines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    continue
                try:
                    parts.append(str(json.loads(data)["choices"][0].get("delta", {}).get("content", "")))
                except (KeyError, IndexError, TypeError, json.JSONDecodeError):
                    continue
            return "".join(parts)
        try:
            return str(response.json()["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise ValueError("Provider 返回缺少 choices[0].message.content") from exc
