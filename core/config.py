from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator


DEFAULT_STRATEGIES = [
    {
        "id": "ai-agents",
        "name": "AI Agent 项目",
        "enabled": False,
        "query": 'agent OR llm OR "ai assistant"',
        "stars_min": 10,
        "stars_max": 500,
    },
    {
        "id": "agent-skills",
        "name": "Agent Skill 项目",
        "enabled": False,
        "query": 'skill OR "claude code" OR codex',
        "stars_min": 10,
        "stars_max": 500,
    },
    {
        "id": "mcp-servers",
        "name": "MCP 服务项目",
        "enabled": False,
        "query": 'mcp OR "model context protocol"',
        "stars_min": 10,
        "stars_max": 500,
    },
]


def normalize_query(value: str) -> str:
    return " ".join(str(value or "").strip().split())


class SearchStrategyConfig(BaseModel):
    id: str
    name: str
    enabled: bool = False
    query: str
    stars_min: int = 10
    stars_max: int = 500
    max_pages: int = 8
    pages_per_run: int = 1
    per_run_target: int = 8

    @field_validator("id", "name", "query")
    @classmethod
    def required_text(cls, value: str) -> str:
        cleaned = normalize_query(value)
        if not cleaned:
            raise ValueError("不能为空")
        return cleaned

    @model_validator(mode="after")
    def validate_limits(self) -> "SearchStrategyConfig":
        if self.stars_min < 0 or self.stars_max < self.stars_min:
            raise ValueError("星标范围无效")
        if self.max_pages < 1 or self.pages_per_run < 1 or self.per_run_target < 1:
            raise ValueError("分页与目标数量必须大于 0")
        return self


class SearchConfig(BaseModel):
    cron: str = "0 * * * *"
    created_window_days: int = 3
    created_lookback_days: int = 90
    exclude_forks: bool = True
    exclude_archived: bool = True
    seen_cooldown_days: int = 14
    max_strategy_runs_per_tick: int = 2
    max_new_repos_per_tick: int = 15
    cooldown_skip_page_threshold: float = 0.8
    max_cooldown_extra_pages_per_strategy: int = 2
    strategies: list[SearchStrategyConfig] = Field(
        default_factory=lambda: [SearchStrategyConfig.model_validate(item) for item in copy.deepcopy(DEFAULT_STRATEGIES)]
    )

    @model_validator(mode="after")
    def validate_strategies(self) -> "SearchConfig":
        ids = [item.id for item in self.strategies]
        if len(ids) != len(set(ids)):
            raise ValueError("策略组 ID 不能重复")
        if self.created_window_days < 1 or self.created_lookback_days < self.created_window_days:
            raise ValueError("创建时间窗口无效")
        if self.seen_cooldown_days < 1 or self.max_strategy_runs_per_tick < 1 or self.max_new_repos_per_tick < 1:
            raise ValueError("采集参数必须大于 0")
        if not 0 <= self.cooldown_skip_page_threshold <= 1:
            raise ValueError("冷却跳过比例必须介于 0 和 1")
        return self


class AgentConfig(BaseModel):
    cron: str = "*/10 * * * *"
    batch_size: int = 1
    max_turns: int = 6
    failure_retry_limit: int = 3

    @model_validator(mode="after")
    def validate_limits(self) -> "AgentConfig":
        if min(self.batch_size, self.max_turns, self.failure_retry_limit) < 1:
            raise ValueError("分析任务参数必须大于 0")
        return self


class ProviderConfig(BaseModel):
    name: str
    base_url: str
    model: str
    active: bool = False

    @field_validator("name", "base_url", "model")
    @classmethod
    def provider_text(cls, value: str) -> str:
        cleaned = str(value or "").strip()
        if not cleaned:
            raise ValueError("Provider 字段不能为空")
        return cleaned


class NotifyConfig(BaseModel):
    instant_enabled: bool = True
    daily_digest_enabled: bool = True
    daily_digest_crons: list[str] = Field(default_factory=lambda: ["0 21 * * *"])

    @field_validator("daily_digest_crons")
    @classmethod
    def normalize_crons(cls, value: list[str]) -> list[str]:
        cleaned = sorted({str(item).strip() for item in value if str(item).strip()})
        if not cleaned:
            raise ValueError("至少保留一个每日摘要时间")
        return cleaned


class FeishuConfig(BaseModel):
    group_chat_id: str = ""


class ControlConfig(BaseModel):
    crawl_enabled: bool = True
    agent_enabled: bool = True


class AppConfig(BaseModel):
    search: SearchConfig = Field(default_factory=SearchConfig)
    agent: AgentConfig = Field(default_factory=AgentConfig)
    providers: list[ProviderConfig] = Field(default_factory=list)
    notify: NotifyConfig = Field(default_factory=NotifyConfig)
    feishu: FeishuConfig = Field(default_factory=FeishuConfig)
    control: ControlConfig = Field(default_factory=ControlConfig)

    @model_validator(mode="after")
    def validate_providers(self) -> "AppConfig":
        names = [item.name for item in self.providers]
        if len(names) != len(set(names)):
            raise ValueError("Provider 名称不能重复")
        if sum(1 for item in self.providers if item.active) > 1:
            raise ValueError("只能启用一个 AI Provider")
        return self


class ConfigStore:
    def __init__(self, config_path: Path, default_path: Path) -> None:
        self.config_path = config_path
        self.default_path = default_path
        self._config = self._load()

    def _read_yaml(self, path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8") as handle:
            return yaml.safe_load(handle) or {}

    def _load(self) -> AppConfig:
        if not self.config_path.exists():
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            self.config_path.write_text(self.default_path.read_text(encoding="utf-8"), encoding="utf-8")
        raw = self._read_yaml(self.config_path)
        config = AppConfig.model_validate(raw)
        normalized = config.model_dump()
        if raw != normalized:
            self._write(normalized)
        return config

    def _write(self, payload: dict[str, Any]) -> None:
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.config_path.write_text(yaml.safe_dump(payload, allow_unicode=True, sort_keys=False), encoding="utf-8")

    def get(self) -> AppConfig:
        return self._config

    def reload(self) -> AppConfig:
        self._config = self._load()
        return self._config

    def save(self, updates: dict[str, Any]) -> AppConfig:
        merged = self._deep_merge(self._config.model_dump(), updates)
        self._config = AppConfig.model_validate(merged)
        self._write(self._config.model_dump())
        return self._config

    def _deep_merge(self, current: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
        merged = dict(current)
        for key, value in updates.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = self._deep_merge(merged[key], value)
            else:
                merged[key] = value
        return merged
