from __future__ import annotations

from typing import Any

from core.github_client import GitHubClient


def _safe_path(path: str) -> bool:
    return bool(path) and not path.startswith("/") and ".." not in path.split("/") and len(path) <= 240


class RepoFileToolbox:
    def __init__(self, *, repo: dict[str, Any], github: GitHubClient, tree_paths: list[str]) -> None:
        self.repo = repo
        self.github = github
        self.tree_paths = tree_paths
        self.calls = 0

    def usage(self) -> dict[str, int]:
        return {"calls": self.calls, "max_calls": 8}

    def search_repo_files(self, query: str = "", *, limit: int = 20) -> dict[str, Any]:
        self.calls += 1
        needle = str(query or "").lower().strip()
        paths = [path for path in self.tree_paths if not needle or needle in path.lower()]
        return {"files": paths[:max(1, min(int(limit or 20), 50))], "truncated": len(paths) > limit}

    async def read_repo_file(self, path: str) -> dict[str, Any]:
        self.calls += 1
        if not _safe_path(path):
            return {"path": path, "content": "", "error": "文件路径无效"}
        content = await self.github.get_file_content(self.repo["owner"], self.repo["name"], path)
        return {"path": path, "content": content}

    async def read_files(self, paths: list[str]) -> dict[str, Any]:
        self.calls += 1
        files = []
        for path in paths[:10]:
            files.append(await self.read_repo_file(str(path)))
        return {"files": files}

    async def execute(self, tool: str, args: dict[str, Any]) -> dict[str, Any]:
        if self.calls >= 8:
            return {"error": "文件读取次数已达上限"}
        if tool == "search_repo_files":
            return self.search_repo_files(str(args.get("query", "")), limit=int(args.get("limit", 20)))
        if tool == "read_repo_file":
            return await self.read_repo_file(str(args.get("path", "")))
        if tool == "read_files":
            paths = args.get("paths", [])
            return await self.read_files(paths if isinstance(paths, list) else [])
        return {"error": "不支持的文件工具"}


async def build_initial_context(repo: dict[str, Any], github: GitHubClient) -> dict[str, Any]:
    readme = ""
    license_name = repo.get("repo_license", "")
    tree_paths: list[str] = []
    try:
        readme = await github.get_readme_excerpt(repo["owner"], repo["name"])
    except Exception:
        pass
    try:
        tree_paths = await github.get_repo_tree(repo["owner"], repo["name"])
    except Exception:
        pass
    if not license_name:
        try:
            license_name = await github.get_license_name(repo["owner"], repo["name"])
        except Exception:
            pass
    return {
        "repo_info": {key: repo.get(key) for key in ("full_name", "description", "language", "stars", "topics", "html_url")},
        "license": license_name or "未知",
        "readme_excerpt": readme,
        "tree_paths": tree_paths,
    }
