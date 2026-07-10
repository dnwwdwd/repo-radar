from __future__ import annotations

import asyncio

from agent.parser import parse_loop_response
from agent.runner import AgentRunner


def final_payload() -> str:
    return '''{"type":"final","result":{"summary":"一个 MCP 示例项目。","purpose":"演示工具调用。","features":["提供示例接口"],"target_users":["开发者"],"tech_stack":["Python"],"deployment_notes":"未知","license":"MIT","evidence":["README.md"],"confidence":0.8,"agent_log":[]}}'''


def test_parser_rejects_legacy_evaluation_schema() -> None:
    result = parse_loop_response(final_payload())["result"]
    assert result["summary"] == "一个 MCP 示例项目。"
    assert set(result) == {"summary", "purpose", "features", "target_users", "tech_stack", "deployment_notes", "license", "evidence", "confidence", "agent_log"}


def test_runner_accepts_openai_compatible_brief() -> None:
    class FakeGitHub:
        async def get_readme_excerpt(self, *_args): return "# Demo"
        async def get_repo_tree(self, *_args): return ["README.md", "pyproject.toml"]
        async def get_license_name(self, *_args): return "MIT"

    async def scenario() -> None:
        runner = AgentRunner()
        async def fake_call(**_kwargs): return final_payload()
        runner._call_provider = fake_call  # type: ignore[method-assign]
        result = await runner.analyze_repo(
            {"id": 1, "owner": "owner", "name": "demo", "full_name": "owner/demo", "description": "", "language": "Python", "stars": 1, "topics": [], "html_url": "https://github.com/owner/demo", "repo_license": "MIT"},
            provider={"name": "test", "base_url": "https://example.com/v1", "model": "model"}, api_key="key", github_client=FakeGitHub(), max_turns=2,
        )
        assert result["features"] == ["提供示例接口"]
        assert result["license"] == "MIT"
    asyncio.run(scenario())
