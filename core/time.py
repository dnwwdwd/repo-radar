from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo


SHANGHAI_TIMEZONE = ZoneInfo("Asia/Shanghai")


def now_utc() -> datetime:
    return datetime.now(UTC)


def shanghai_day(value: datetime | None = None) -> str:
    return (value or now_utc()).astimezone(SHANGHAI_TIMEZONE).date().isoformat()
