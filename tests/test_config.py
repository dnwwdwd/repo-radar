from __future__ import annotations

import pytest

from core.config import AppConfig, SearchConfig


def test_default_strategies_are_disabled_and_topic_focused() -> None:
    config = SearchConfig()
    assert [item.id for item in config.strategies] == ["ai-agents", "agent-skills", "mcp-servers"]
    assert all(not item.enabled for item in config.strategies)
    assert all(item.stars_min == 10 and item.stars_max == 500 for item in config.strategies)


def test_rejects_duplicate_strategy_id() -> None:
    with pytest.raises(ValueError, match="不能重复"):
        AppConfig.model_validate({"search": {"strategies": [{"id": "same", "name": "A", "query": "agent"}, {"id": "same", "name": "B", "query": "mcp"}]}})
