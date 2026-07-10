from __future__ import annotations

import json
from typing import Any


STRING_FIELDS = ("summary", "purpose", "deployment_notes", "license")
LIST_FIELDS = ("features", "target_users", "tech_stack", "evidence", "agent_log")


def _load_json(payload: str) -> dict[str, Any]:
    text = str(payload or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("AI 返回的内容不是 JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("AI 返回的 JSON 必须是对象")
    return parsed


def validate_brief(result: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(result)
    for field in STRING_FIELDS:
        value = str(normalized.get(field, "") or "").strip()
        normalized[field] = value or "未知"
    for field in LIST_FIELDS:
        value = normalized.get(field, [])
        if not isinstance(value, list):
            raise ValueError(f"字段 {field} 必须是数组")
        if field == "agent_log":
            normalized[field] = [
                {"thought": str(item.get("thought", ""))[:2000], "action": str(item.get("action", ""))[:200]}
                for item in value if isinstance(item, dict)
            ]
        else:
            normalized[field] = [str(item).strip() for item in value if str(item).strip()][:20]
    try:
        confidence = float(normalized.get("confidence", 0))
    except (TypeError, ValueError) as exc:
        raise ValueError("confidence 必须是数字") from exc
    if not 0 <= confidence <= 1:
        raise ValueError("confidence 必须介于 0 和 1")
    normalized["confidence"] = confidence
    return normalized


def parse_loop_response(payload: str) -> dict[str, Any]:
    parsed = _load_json(payload)
    if parsed.get("type") == "tool_call":
        tool = str(parsed.get("tool", ""))
        if tool not in {"search_repo_files", "read_repo_file", "read_files"}:
            raise ValueError("AI 请求了不支持的文件工具")
        args = parsed.get("args", {})
        if not isinstance(args, dict):
            raise ValueError("文件工具参数必须是对象")
        return {"type": "tool_call", "tool": tool, "args": args, "reason": str(parsed.get("reason", ""))}
    if parsed.get("type") == "final":
        result = parsed.get("result")
        if not isinstance(result, dict):
            raise ValueError("最终结果缺失")
        return {"type": "final", "result": validate_brief(result)}
    return {"type": "final", "result": validate_brief(parsed)}
