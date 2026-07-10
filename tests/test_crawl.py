from __future__ import annotations

from datetime import UTC, datetime, timedelta

from core.config import SearchConfig, SearchStrategyConfig
from core.crawl import build_search_query, cooldown_until, should_skip_seen


def test_query_contains_per_strategy_star_range_and_window() -> None:
    config = SearchConfig(strategies=[])
    strategy = SearchStrategyConfig(id="mcp", name="MCP", query="mcp", stars_min=30, stars_max=900)
    query = build_search_query(config, strategy, window_start="2026-07-01", window_end="2026-07-03")
    assert "mcp" in query
    assert "stars:30..900" in query
    assert "created:2026-07-01..2026-07-03" in query
    assert "fork:false" in query


def test_cooldown_skips_only_before_expiry() -> None:
    now = datetime(2026, 7, 10, tzinfo=UTC)
    assert should_skip_seen(cooldown_until(now=now, days=14), now=now)
    assert not should_skip_seen((now - timedelta(seconds=1)).isoformat(), now=now)
