from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta

from core.config import SearchConfig, SearchStrategyConfig, normalize_query


@dataclass
class CrawlCounters:
    fetched: int = 0
    saved_new: int = 0
    saved_existing: int = 0
    skipped_seen: int = 0

    def to_dict(self) -> dict[str, int]:
        return asdict(self)


def strategy_signature(search: SearchConfig, strategy: SearchStrategyConfig) -> str:
    payload = {
        "query": normalize_query(strategy.query),
        "stars_min": strategy.stars_min,
        "stars_max": strategy.stars_max,
        "created_window_days": search.created_window_days,
        "created_lookback_days": search.created_lookback_days,
        "exclude_forks": search.exclude_forks,
        "exclude_archived": search.exclude_archived,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def initialize_window(*, now: datetime, days: int) -> tuple[str, str]:
    end = now.date()
    start = end - timedelta(days=max(days - 1, 0))
    return start.isoformat(), end.isoformat()


def advance_window(*, now: datetime, current_start: str, days: int, lookback_days: int) -> tuple[str, str]:
    start = datetime.fromisoformat(current_start).date() - timedelta(days=days)
    minimum = now.date() - timedelta(days=lookback_days)
    if start < minimum:
        start = now.date() - timedelta(days=max(days - 1, 0))
    end = start + timedelta(days=max(days - 1, 0))
    return start.isoformat(), end.isoformat()


def build_search_query(search: SearchConfig, strategy: SearchStrategyConfig, *, window_start: str, window_end: str) -> str:
    qualifiers = [
        normalize_query(strategy.query),
        f"stars:{strategy.stars_min}..{strategy.stars_max}",
        f"created:{window_start}..{window_end}",
        "fork:false" if search.exclude_forks else "",
        "archived:false" if search.exclude_archived else "",
    ]
    return " ".join(item for item in qualifiers if item)


def should_skip_seen(cooldown_until: str | None, *, now: datetime | None = None) -> bool:
    if not cooldown_until:
        return False
    try:
        return datetime.fromisoformat(cooldown_until) > (now or datetime.now(UTC))
    except ValueError:
        return False


def cooldown_until(*, now: datetime, days: int) -> str:
    return (now + timedelta(days=max(days, 1))).isoformat()
