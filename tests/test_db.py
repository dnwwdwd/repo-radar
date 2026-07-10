from __future__ import annotations

import asyncio
from pathlib import Path

from core.db import Database


def repo(*, github_id: str = "42", full_name: str = "owner/example") -> dict:
    return {
        "github_repo_id": github_id,
        "full_name": full_name,
        "owner": full_name.split("/")[0],
        "name": full_name.split("/")[1],
        "html_url": f"https://github.com/{full_name}",
        "description": "example",
        "language": "Python",
        "stars": 33,
        "topics": ["mcp"],
        "repo_license": "MIT",
        "created_at": "2026-07-01T00:00:00+00:00",
        "updated_at": "2026-07-02T00:00:00+00:00",
        "fetched_at": "2026-07-10T00:00:00+00:00",
    }


def test_repository_dedupes_by_github_id_and_tracks_sources(tmp_path: Path) -> None:
    async def scenario() -> None:
        db = Database(tmp_path / "repo-radar.db")
        await db.init()
        first, inserted = await db.upsert_repo(repo(), strategy_id="ai-agents")
        second, inserted_again = await db.upsert_repo(repo(full_name="new-owner/new-name"), strategy_id="mcp-servers")
        assert inserted is True
        assert inserted_again is False
        assert first["id"] == second["id"]
        assert second["full_name"] == "new-owner/new-name"
        assert second["source_strategy_ids"] == ["ai-agents", "mcp-servers"]
        items, total = await db.list_repos()
        assert total == 1
        assert items[0]["github_repo_id"] == "42"
    asyncio.run(scenario())
