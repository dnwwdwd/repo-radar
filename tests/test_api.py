from __future__ import annotations

import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from main import create_app


def build_app(tmp_path: Path):
    shutil.copy(Path(__file__).parents[1] / "config.example.yml", tmp_path / "config.example.yml")
    return create_app(tmp_path)


def test_public_local_api_has_no_login_flow_and_exposes_config(tmp_path: Path) -> None:
    with TestClient(build_app(tmp_path)) as client:
        assert client.get("/api/repos").status_code == 200
        config = client.get("/api/config").json()
        assert [item["id"] for item in config["search"]["strategies"]] == ["ai-agents", "agent-skills", "mcp-servers"]
        assert client.get("/api/auth/session").status_code == 404
        response = client.put("/api/config", json={"search": {"strategies": [{"id": "one", "name": "One", "enabled": True, "query": "mcp", "stars_min": 1, "stars_max": 10}]}})
        assert response.status_code == 200
        assert response.json()["config"]["search"]["strategies"][0]["id"] == "one"
