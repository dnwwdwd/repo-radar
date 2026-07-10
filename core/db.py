from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import aiosqlite


REPO_STATUSES = {"queued", "analyzing", "analyzed", "failed", "ignored", "archived"}


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path

    async def _connect(self) -> aiosqlite.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = await aiosqlite.connect(self.path)
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA foreign_keys = ON")
        return db

    async def init(self) -> None:
        db = await self._connect()
        try:
            await db.executescript(
                """
                CREATE TABLE IF NOT EXISTS repositories (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  github_repo_id TEXT NOT NULL UNIQUE,
                  full_name TEXT NOT NULL,
                  owner TEXT NOT NULL,
                  name TEXT NOT NULL,
                  html_url TEXT NOT NULL,
                  description TEXT NOT NULL DEFAULT '',
                  language TEXT NOT NULL DEFAULT '',
                  stars INTEGER NOT NULL DEFAULT 0,
                  topics_json TEXT NOT NULL DEFAULT '[]',
                  repo_license TEXT NOT NULL DEFAULT '',
                  created_at TEXT NOT NULL DEFAULT '',
                  updated_at TEXT NOT NULL DEFAULT '',
                  fetched_at TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'queued',
                  retry_count INTEGER NOT NULL DEFAULT 0,
                  failure_message TEXT NOT NULL DEFAULT ''
                );
                CREATE INDEX IF NOT EXISTS idx_repositories_status_fetched ON repositories(status, fetched_at DESC);
                CREATE INDEX IF NOT EXISTS idx_repositories_language ON repositories(language);
                CREATE TABLE IF NOT EXISTS repository_sources (
                  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
                  strategy_id TEXT NOT NULL,
                  first_seen_at TEXT NOT NULL,
                  last_seen_at TEXT NOT NULL,
                  PRIMARY KEY(repo_id, strategy_id)
                );
                CREATE TABLE IF NOT EXISTS analyses (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  repo_id INTEGER NOT NULL UNIQUE REFERENCES repositories(id) ON DELETE CASCADE,
                  provider_name TEXT NOT NULL,
                  model TEXT NOT NULL,
                  analysis_version TEXT NOT NULL,
                  summary TEXT NOT NULL,
                  purpose TEXT NOT NULL,
                  features_json TEXT NOT NULL DEFAULT '[]',
                  target_users_json TEXT NOT NULL DEFAULT '[]',
                  tech_stack_json TEXT NOT NULL DEFAULT '[]',
                  deployment_notes TEXT NOT NULL,
                  license TEXT NOT NULL,
                  evidence_json TEXT NOT NULL DEFAULT '[]',
                  confidence REAL NOT NULL,
                  agent_log_json TEXT NOT NULL DEFAULT '[]',
                  analyzed_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS crawl_seen (
                  github_repo_id TEXT PRIMARY KEY,
                  seen_at TEXT NOT NULL,
                  cooldown_until TEXT NOT NULL,
                  strategy_ids_json TEXT NOT NULL DEFAULT '[]',
                  decision TEXT NOT NULL,
                  reason TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS crawl_strategy_state (
                  strategy_id TEXT PRIMARY KEY,
                  signature TEXT NOT NULL,
                  next_page INTEGER NOT NULL,
                  window_start TEXT NOT NULL,
                  window_end TEXT NOT NULL,
                  last_run_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS notification_events (
                  dedupe_key TEXT PRIMARY KEY,
                  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
                  notification_type TEXT NOT NULL,
                  sent_at TEXT NOT NULL,
                  payload_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS runtime_events (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  category TEXT NOT NULL,
                  event_type TEXT NOT NULL,
                  status TEXT NOT NULL,
                  summary TEXT NOT NULL,
                  payload_json TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL,
                  repo_id INTEGER REFERENCES repositories(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_runtime_events_created ON runtime_events(created_at DESC);
                """
            )
            await db.commit()
        finally:
            await db.close()

    async def upsert_repo(self, repo: dict[str, Any], *, strategy_id: str) -> tuple[dict[str, Any], bool]:
        now = str(repo["fetched_at"])
        db = await self._connect()
        try:
            cursor = await db.execute("SELECT id FROM repositories WHERE github_repo_id = ?", (repo["github_repo_id"],))
            existing = await cursor.fetchone()
            inserted = existing is None
            if inserted:
                cursor = await db.execute(
                    """
                    INSERT INTO repositories (
                      github_repo_id, full_name, owner, name, html_url, description, language, stars,
                      topics_json, repo_license, created_at, updated_at, fetched_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        repo["github_repo_id"], repo["full_name"], repo["owner"], repo["name"], repo["html_url"],
                        repo["description"], repo["language"], repo["stars"], json.dumps(repo["topics"], ensure_ascii=False),
                        repo["repo_license"], repo["created_at"], repo["updated_at"], now,
                    ),
                )
                repo_id = int(cursor.lastrowid)
            else:
                repo_id = int(existing["id"])
                await db.execute(
                    """
                    UPDATE repositories SET full_name=?, owner=?, name=?, html_url=?, description=?, language=?, stars=?,
                      topics_json=?, repo_license=?, created_at=?, updated_at=?, fetched_at=? WHERE id=?
                    """,
                    (
                        repo["full_name"], repo["owner"], repo["name"], repo["html_url"], repo["description"], repo["language"],
                        repo["stars"], json.dumps(repo["topics"], ensure_ascii=False), repo["repo_license"], repo["created_at"],
                        repo["updated_at"], now, repo_id,
                    ),
                )
            await db.execute(
                """
                INSERT INTO repository_sources(repo_id, strategy_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
                ON CONFLICT(repo_id, strategy_id) DO UPDATE SET last_seen_at=excluded.last_seen_at
                """,
                (repo_id, strategy_id, now, now),
            )
            await db.commit()
            return await self._get_repo_by_id(db, repo_id), inserted
        finally:
            await db.close()

    async def get_repo_by_id(self, repo_id: int) -> dict[str, Any] | None:
        db = await self._connect()
        try:
            return await self._get_repo_by_id(db, repo_id)
        finally:
            await db.close()

    async def _get_repo_by_id(self, db: aiosqlite.Connection, repo_id: int) -> dict[str, Any] | None:
        cursor = await db.execute(
            """
            SELECT r.*, a.provider_name, a.model, a.analysis_version, a.summary, a.purpose, a.features_json,
              a.target_users_json, a.tech_stack_json, a.deployment_notes, a.license AS analysis_license,
              a.evidence_json, a.confidence, a.agent_log_json, a.analyzed_at
            FROM repositories r LEFT JOIN analyses a ON a.repo_id = r.id WHERE r.id = ?
            """,
            (repo_id,),
        )
        row = await cursor.fetchone()
        return await self._row_to_repo(db, row) if row else None

    async def _row_to_repo(self, db: aiosqlite.Connection, row: aiosqlite.Row) -> dict[str, Any]:
        source_rows = await (await db.execute("SELECT strategy_id FROM repository_sources WHERE repo_id=? ORDER BY strategy_id", (row["id"],))).fetchall()
        analysis = {
            "provider_name": row["provider_name"] or "",
            "model": row["model"] or "",
            "analysis_version": row["analysis_version"] or "",
            "summary": row["summary"] or "",
            "purpose": row["purpose"] or "",
            "features": json.loads(row["features_json"] or "[]"),
            "target_users": json.loads(row["target_users_json"] or "[]"),
            "tech_stack": json.loads(row["tech_stack_json"] or "[]"),
            "deployment_notes": row["deployment_notes"] or "",
            "license": row["analysis_license"] or row["repo_license"] or "",
            "evidence": json.loads(row["evidence_json"] or "[]"),
            "confidence": float(row["confidence"] or 0),
            "agent_log": json.loads(row["agent_log_json"] or "[]"),
            "analyzed_at": row["analyzed_at"] or "",
        }
        return {
            "id": int(row["id"]),
            "github_repo_id": row["github_repo_id"],
            "full_name": row["full_name"],
            "owner": row["owner"],
            "name": row["name"],
            "html_url": row["html_url"],
            "description": row["description"],
            "language": row["language"],
            "stars": int(row["stars"]),
            "topics": json.loads(row["topics_json"] or "[]"),
            "repo_license": row["repo_license"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "fetched_at": row["fetched_at"],
            "status": row["status"],
            "retry_count": int(row["retry_count"]),
            "failure_message": row["failure_message"],
            "source_strategy_ids": [item["strategy_id"] for item in source_rows],
            "analysis": analysis,
        }

    async def list_repos(
        self, *, repo_query: str = "", language: str = "", strategy_id: str = "", statuses: list[str] | None = None,
        stars_min: int | None = None, stars_max: int | None = None, date_from: str = "", date_to: str = "", page: int = 1, page_size: int = 20,
    ) -> tuple[list[dict[str, Any]], int]:
        clauses: list[str] = []
        values: list[Any] = []
        if repo_query:
            clauses.append("(r.full_name LIKE ? OR r.description LIKE ?)")
            values.extend([f"%{repo_query}%", f"%{repo_query}%"])
        if language:
            clauses.append("r.language = ?")
            values.append(language)
        if strategy_id:
            clauses.append("EXISTS (SELECT 1 FROM repository_sources rs WHERE rs.repo_id=r.id AND rs.strategy_id=?)")
            values.append(strategy_id)
        if statuses:
            valid = [item for item in statuses if item in REPO_STATUSES]
            if valid:
                clauses.append(f"r.status IN ({','.join('?' for _ in valid)})")
                values.extend(valid)
        if stars_min is not None:
            clauses.append("r.stars >= ?")
            values.append(stars_min)
        if stars_max is not None:
            clauses.append("r.stars <= ?")
            values.append(stars_max)
        if date_from:
            clauses.append("substr(r.fetched_at, 1, 10) >= ?")
            values.append(date_from)
        if date_to:
            clauses.append("substr(r.fetched_at, 1, 10) <= ?")
            values.append(date_to)
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        db = await self._connect()
        try:
            total = int((await (await db.execute(f"SELECT COUNT(*) AS count FROM repositories r{where}", values)).fetchone())["count"])
            offset = max(page - 1, 0) * max(page_size, 1)
            cursor = await db.execute(
                f"""
                SELECT r.*, a.provider_name, a.model, a.analysis_version, a.summary, a.purpose, a.features_json,
                  a.target_users_json, a.tech_stack_json, a.deployment_notes, a.license AS analysis_license,
                  a.evidence_json, a.confidence, a.agent_log_json, a.analyzed_at
                FROM repositories r LEFT JOIN analyses a ON a.repo_id=r.id {where}
                ORDER BY r.fetched_at DESC LIMIT ? OFFSET ?
                """,
                [*values, max(min(page_size, 100), 1), offset],
            )
            return [await self._row_to_repo(db, row) for row in await cursor.fetchall()], total
        finally:
            await db.close()

    async def list_languages(self) -> list[str]:
        db = await self._connect()
        try:
            rows = await (await db.execute("SELECT DISTINCT language FROM repositories WHERE language <> '' ORDER BY language")).fetchall()
            return [str(row["language"]) for row in rows]
        finally:
            await db.close()

    async def get_pending_repo(self, retry_limit: int) -> dict[str, Any] | None:
        db = await self._connect()
        try:
            row = await (await db.execute(
                """
                SELECT id FROM repositories
                WHERE status='queued' OR (status='failed' AND retry_count < ?)
                ORDER BY CASE status WHEN 'queued' THEN 0 ELSE 1 END, fetched_at ASC LIMIT 1
                """,
                (retry_limit,),
            )).fetchone()
            return await self._get_repo_by_id(db, int(row["id"])) if row else None
        finally:
            await db.close()

    async def mark_analyzing(self, repo_id: int) -> None:
        db = await self._connect()
        try:
            await db.execute("UPDATE repositories SET status='analyzing', failure_message='' WHERE id=?", (repo_id,))
            await db.commit()
        finally:
            await db.close()

    async def mark_failed(self, repo_id: int, message: str) -> None:
        db = await self._connect()
        try:
            await db.execute("UPDATE repositories SET status='failed', retry_count=retry_count+1, failure_message=? WHERE id=?", (message[:1000], repo_id))
            await db.commit()
        finally:
            await db.close()

    async def save_analysis(self, repo_id: int, result: dict[str, Any], *, provider_name: str, model: str, analyzed_at: str) -> None:
        db = await self._connect()
        try:
            await db.execute(
                """
                INSERT INTO analyses(
                  repo_id, provider_name, model, analysis_version, summary, purpose, features_json, target_users_json,
                  tech_stack_json, deployment_notes, license, evidence_json, confidence, agent_log_json, analyzed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(repo_id) DO UPDATE SET provider_name=excluded.provider_name, model=excluded.model,
                  analysis_version=excluded.analysis_version, summary=excluded.summary, purpose=excluded.purpose,
                  features_json=excluded.features_json, target_users_json=excluded.target_users_json,
                  tech_stack_json=excluded.tech_stack_json, deployment_notes=excluded.deployment_notes,
                  license=excluded.license, evidence_json=excluded.evidence_json, confidence=excluded.confidence,
                  agent_log_json=excluded.agent_log_json, analyzed_at=excluded.analyzed_at
                """,
                (
                    repo_id, provider_name, model, "v1", result["summary"], result["purpose"],
                    json.dumps(result["features"], ensure_ascii=False), json.dumps(result["target_users"], ensure_ascii=False),
                    json.dumps(result["tech_stack"], ensure_ascii=False), result["deployment_notes"], result["license"],
                    json.dumps(result["evidence"], ensure_ascii=False), result["confidence"],
                    json.dumps(result.get("agent_log", []), ensure_ascii=False), analyzed_at,
                ),
            )
            await db.execute("UPDATE repositories SET status='analyzed', failure_message='' WHERE id=?", (repo_id,))
            await db.commit()
        finally:
            await db.close()

    async def update_repo_status(self, repo_id: int, status: str) -> dict[str, Any] | None:
        if status not in {"queued", "ignored", "archived"}:
            raise ValueError("只允许更新为 queued、ignored 或 archived")
        db = await self._connect()
        try:
            if status == "queued":
                await db.execute("UPDATE repositories SET status='queued', retry_count=0, failure_message='' WHERE id=?", (repo_id,))
            else:
                await db.execute("UPDATE repositories SET status=? WHERE id=?", (status, repo_id))
            await db.commit()
            return await self._get_repo_by_id(db, repo_id)
        finally:
            await db.close()

    async def archive_repositories(self, *, mode: str, date: str | None = None) -> int:
        db = await self._connect()
        try:
            if mode == "fetched_before":
                cursor = await db.execute("UPDATE repositories SET status='archived' WHERE status <> 'analyzing' AND substr(fetched_at, 1, 10) < ?", (date or "",))
            elif mode == "ignored":
                cursor = await db.execute("UPDATE repositories SET status='archived' WHERE status='ignored'")
            else:
                raise ValueError("不支持的归档模式")
            await db.commit()
            return cursor.rowcount
        finally:
            await db.close()

    async def get_crawl_seen(self, github_repo_id: str) -> dict[str, Any] | None:
        db = await self._connect()
        try:
            row = await (await db.execute("SELECT * FROM crawl_seen WHERE github_repo_id=?", (github_repo_id,))).fetchone()
            return dict(row) if row else None
        finally:
            await db.close()

    async def upsert_crawl_seen(self, *, github_repo_id: str, seen_at: str, cooldown_until: str, strategy_id: str, decision: str, reason: str = "") -> None:
        db = await self._connect()
        try:
            row = await (await db.execute("SELECT strategy_ids_json FROM crawl_seen WHERE github_repo_id=?", (github_repo_id,))).fetchone()
            ids = set(json.loads(row["strategy_ids_json"] or "[]")) if row else set()
            ids.add(strategy_id)
            await db.execute(
                """
                INSERT INTO crawl_seen(github_repo_id, seen_at, cooldown_until, strategy_ids_json, decision, reason)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(github_repo_id) DO UPDATE SET seen_at=excluded.seen_at, cooldown_until=excluded.cooldown_until,
                  strategy_ids_json=excluded.strategy_ids_json, decision=excluded.decision, reason=excluded.reason
                """,
                (github_repo_id, seen_at, cooldown_until, json.dumps(sorted(ids)), decision, reason),
            )
            await db.commit()
        finally:
            await db.close()

    async def get_strategy_state(self, strategy_id: str) -> dict[str, Any] | None:
        db = await self._connect()
        try:
            row = await (await db.execute("SELECT * FROM crawl_strategy_state WHERE strategy_id=?", (strategy_id,))).fetchone()
            return dict(row) if row else None
        finally:
            await db.close()

    async def upsert_strategy_state(self, *, strategy_id: str, signature: str, next_page: int, window_start: str, window_end: str, last_run_at: str) -> None:
        db = await self._connect()
        try:
            await db.execute(
                """
                INSERT INTO crawl_strategy_state(strategy_id, signature, next_page, window_start, window_end, last_run_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(strategy_id) DO UPDATE SET signature=excluded.signature, next_page=excluded.next_page,
                  window_start=excluded.window_start, window_end=excluded.window_end, last_run_at=excluded.last_run_at
                """,
                (strategy_id, signature, next_page, window_start, window_end, last_run_at),
            )
            await db.commit()
        finally:
            await db.close()

    async def list_strategy_states(self) -> list[dict[str, Any]]:
        db = await self._connect()
        try:
            rows = await (await db.execute("SELECT * FROM crawl_strategy_state ORDER BY strategy_id")).fetchall()
            return [dict(row) for row in rows]
        finally:
            await db.close()

    async def clear_strategy_states(self) -> int:
        db = await self._connect()
        try:
            cursor = await db.execute("DELETE FROM crawl_strategy_state")
            await db.commit()
            return cursor.rowcount
        finally:
            await db.close()

    async def clear_crawl_seen(self) -> int:
        db = await self._connect()
        try:
            cursor = await db.execute("DELETE FROM crawl_seen")
            await db.commit()
            return cursor.rowcount
        finally:
            await db.close()

    async def count_crawl_seen(self) -> int:
        db = await self._connect()
        try:
            return int((await (await db.execute("SELECT COUNT(*) AS count FROM crawl_seen")).fetchone())["count"])
        finally:
            await db.close()

    async def get_queue_counts(self) -> dict[str, int]:
        db = await self._connect()
        try:
            rows = await (await db.execute("SELECT status, COUNT(*) AS count FROM repositories GROUP BY status")).fetchall()
            counts = {status: 0 for status in REPO_STATUSES}
            counts.update({str(row["status"]): int(row["count"]) for row in rows})
            return counts
        finally:
            await db.close()

    async def get_digest_repos(self, day_prefix: str) -> list[dict[str, Any]]:
        db = await self._connect()
        try:
            rows = await (await db.execute(
                "SELECT r.id FROM repositories r JOIN analyses a ON a.repo_id=r.id WHERE substr(a.analyzed_at, 1, 10)=? ORDER BY r.stars DESC",
                (day_prefix,),
            )).fetchall()
            return [await self._get_repo_by_id(db, int(row["id"])) for row in rows]
        finally:
            await db.close()

    async def has_notification(self, dedupe_key: str) -> bool:
        db = await self._connect()
        try:
            return bool(await (await db.execute("SELECT 1 FROM notification_events WHERE dedupe_key=?", (dedupe_key,))).fetchone())
        finally:
            await db.close()

    async def record_notification(self, *, dedupe_key: str, repo_id: int, notification_type: str, sent_at: str, payload: dict[str, Any]) -> None:
        db = await self._connect()
        try:
            await db.execute(
                "INSERT OR IGNORE INTO notification_events(dedupe_key, repo_id, notification_type, sent_at, payload_json) VALUES (?, ?, ?, ?, ?)",
                (dedupe_key, repo_id, notification_type, sent_at, json.dumps(payload, ensure_ascii=False)),
            )
            await db.commit()
        finally:
            await db.close()

    async def record_event(self, *, category: str, event_type: str, status: str, summary: str, created_at: str, payload: dict[str, Any] | None = None, repo_id: int | None = None) -> None:
        db = await self._connect()
        try:
            await db.execute(
                "INSERT INTO runtime_events(category, event_type, status, summary, payload_json, created_at, repo_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (category, event_type, status, summary, json.dumps(payload or {}, ensure_ascii=False), created_at, repo_id),
            )
            await db.commit()
        finally:
            await db.close()

    async def list_events(self, *, limit: int = 100, category: str = "") -> list[dict[str, Any]]:
        db = await self._connect()
        try:
            if category:
                rows = await (await db.execute("SELECT * FROM runtime_events WHERE category=? ORDER BY id DESC LIMIT ?", (category, limit))).fetchall()
            else:
                rows = await (await db.execute("SELECT * FROM runtime_events ORDER BY id DESC LIMIT ?", (limit,))).fetchall()
            return [{**dict(row), "payload": json.loads(row["payload_json"] or "{}"), "payload_json": None} for row in rows]
        finally:
            await db.close()
