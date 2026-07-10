from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx


GITHUB_API_BASE_URL = "https://api.github.com"
NO_TOKEN_MIN_INTERVAL = timedelta(hours=4)


class GitHubClientError(Exception):
    def __init__(self, code: str, message: str, *, status_code: int | None = None, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


@dataclass
class TokenStatus:
    state: str
    message: str
    remaining: int | None = None
    degraded_mode: bool = False
    crawl_paused: bool = False


class GitHubClient:
    def __init__(self, token: str = "", timeout: float = 20.0) -> None:
        self.token = token.strip()
        self.timeout = timeout
        self._last_unauthenticated_request: datetime | None = None
        self._token_status = TokenStatus(
            state="configured" if self.token else "anonymous",
            message="GitHub Token 已配置" if self.token else "未配置 Token，采集频率受限",
            degraded_mode=not bool(self.token),
        )

    def set_token(self, token: str) -> None:
        self.token = token.strip()
        self._token_status = TokenStatus(
            state="configured" if self.token else "anonymous",
            message="GitHub Token 已配置" if self.token else "未配置 Token，采集频率受限",
            degraded_mode=not bool(self.token),
        )

    def get_token_status(self) -> TokenStatus:
        return self._token_status

    async def _request(self, method: str, path: str, *, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.token:
            now = datetime.now(UTC)
            if self._last_unauthenticated_request and now - self._last_unauthenticated_request < NO_TOKEN_MIN_INTERVAL:
                raise GitHubClientError("github_token_missing", "未配置 GitHub Token，匿名采集处于冷却期", status_code=429)
            self._last_unauthenticated_request = now
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "RepoRadar/0.1",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.request(method, f"{GITHUB_API_BASE_URL}{path}", params=params, headers=headers)
        except httpx.HTTPError as exc:
            raise GitHubClientError("github_network_error", f"GitHub 请求失败：{exc}") from exc

        remaining_value = response.headers.get("x-ratelimit-remaining")
        remaining = int(remaining_value) if remaining_value and remaining_value.isdigit() else None
        if response.status_code == 401:
            self._token_status = TokenStatus("invalid", "GitHub Token 无效，采集已暂停", remaining, True, True)
            raise GitHubClientError("github_token_invalid", "GitHub Token 无效，采集已暂停", status_code=401)
        if response.status_code in {403, 429}:
            self._token_status = TokenStatus("rate_limited", "GitHub API 限额不足，稍后重试", remaining, True, False)
            raise GitHubClientError("github_rate_limited", "GitHub API 限额不足，稍后重试", status_code=response.status_code)
        if response.status_code >= 400:
            message = "GitHub 请求失败"
            try:
                message = str(response.json().get("message") or message)
            except ValueError:
                pass
            raise GitHubClientError("github_request_failed", message, status_code=response.status_code)
        self._token_status = TokenStatus("configured" if self.token else "anonymous", "GitHub 连接正常", remaining, not bool(self.token), False)
        return response.json()

    def _normalize_repo(self, item: dict[str, Any], *, fetched_at: str | None = None) -> dict[str, Any]:
        owner = item.get("owner") or {}
        full_name = str(item.get("full_name") or "")
        if "/" not in full_name:
            full_name = f"{owner.get('login', '')}/{item.get('name', '')}".strip("/")
        owner_name, _, repo_name = full_name.partition("/")
        return {
            "github_repo_id": str(item.get("id") or ""),
            "full_name": full_name,
            "owner": owner_name,
            "name": repo_name,
            "html_url": str(item.get("html_url") or f"https://github.com/{full_name}"),
            "description": str(item.get("description") or ""),
            "language": str(item.get("language") or ""),
            "stars": int(item.get("stargazers_count") or 0),
            "topics": [str(topic) for topic in item.get("topics") or []],
            "repo_license": str((item.get("license") or {}).get("spdx_id") or ""),
            "created_at": str(item.get("created_at") or ""),
            "updated_at": str(item.get("updated_at") or ""),
            "fetched_at": fetched_at or datetime.now(UTC).isoformat(),
        }

    async def search_repositories(self, query: str, *, page: int, sort: str = "updated", order: str = "desc") -> list[dict[str, Any]]:
        payload = await self._request(
            "GET",
            "/search/repositories",
            params={"q": query, "sort": sort, "order": order, "per_page": 100, "page": page},
        )
        fetched_at = datetime.now(UTC).isoformat()
        return [self._normalize_repo(item, fetched_at=fetched_at) for item in payload.get("items", [])]

    async def get_repository(self, owner: str, name: str) -> dict[str, Any]:
        return self._normalize_repo(await self._request("GET", f"/repos/{owner}/{name}"))

    async def get_readme_excerpt(self, owner: str, name: str, *, limit: int = 6000) -> str:
        payload = await self._request("GET", f"/repos/{owner}/{name}/readme")
        encoded = str(payload.get("content") or "").replace("\n", "")
        try:
            return base64.b64decode(encoded).decode("utf-8", errors="replace")[:limit]
        except Exception:
            return ""

    async def get_repo_tree(self, owner: str, name: str, *, limit: int = 800) -> list[str]:
        payload = await self._request("GET", f"/repos/{owner}/{name}/git/trees/HEAD", params={"recursive": "1"})
        return [str(item.get("path")) for item in payload.get("tree", []) if item.get("type") == "blob"][:limit]

    async def get_file_content(self, owner: str, name: str, path: str, *, limit: int = 12000) -> str:
        payload = await self._request("GET", f"/repos/{owner}/{name}/contents/{path}")
        encoded = str(payload.get("content") or "").replace("\n", "")
        try:
            return base64.b64decode(encoded).decode("utf-8", errors="replace")[:limit]
        except Exception:
            return ""

    async def get_license_name(self, owner: str, name: str) -> str:
        payload = await self._request("GET", f"/repos/{owner}/{name}/license")
        return str((payload.get("license") or {}).get("spdx_id") or "")
