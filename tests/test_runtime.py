from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from core.github_client import GitHubClientError
from main import create_app


def test_invalid_github_token_pauses_crawl(tmp_path: Path) -> None:
    shutil.copy(Path(__file__).parents[1] / "config.example.yml", tmp_path / "config.example.yml")
    app = create_app(tmp_path)
    state = app.state.app_state

    async def scenario() -> None:
        await state.db.init()
        state.config_store.save({"search": {"strategies": [{"id": "mcp", "name": "MCP", "enabled": True, "query": "mcp", "stars_min": 10, "stars_max": 500}]}})
        async def invalid_token(*_args, **_kwargs):
            raise GitHubClientError("github_token_invalid", "GitHub Token 无效，采集已暂停", status_code=401)
        state.github.search_repositories = invalid_token  # type: ignore[method-assign]
        result = await state.run_crawl_job()
        assert result["error_code"] == "github_token_invalid"
        assert state.config_store.get().control.crawl_enabled is False
    asyncio.run(scenario())
