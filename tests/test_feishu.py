from __future__ import annotations

from types import SimpleNamespace

from notifier.feishu import FeishuNotifier


def test_group_card_contains_project_brief_without_evaluation_fields() -> None:
    notifier = FeishuNotifier()
    card = notifier._instant_card({
        "full_name": "owner/demo", "html_url": "https://github.com/owner/demo", "language": "Python", "stars": 12,
        "repo_license": "MIT", "analysis": {"summary": "示例项目", "features": ["功能 A"], "license": "MIT"},
    })
    content = str(card)
    assert "主要功能" in content
    assert "难度" not in content
    ready, _ = notifier.is_ready(config=SimpleNamespace(feishu=SimpleNamespace(group_chat_id="oc_test")), secrets={"feishu": {"app_id": "id", "app_secret": "secret"}})
    assert ready is True
