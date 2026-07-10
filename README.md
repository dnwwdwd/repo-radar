# RepoRadar

RepoRadar 定时发现符合自定义 GitHub Search 条件的新仓库，用 AI Provider 生成中文项目介绍，并推送到飞书群聊。

它适合持续关注 AI Agent、Agent Skill、MCP 服务和其他 GitHub 技术方向的个人或团队。

## 功能

- 多策略组采集：每组独立配置 GitHub Query、星标范围、分页和启停状态。
- 冷却与去重：按 GitHub 不可变仓库 ID 去重，避免同一仓库反复入库或反复调用 AI。
- AI 项目介绍：从 README、文件树和公开文件中整理项目用途、功能、目标用户、技术信息与运行说明。
- 飞书群聊：支持即时项目介绍和每日摘要。
- 本机控制台：仓库、运行状态、设置三页完成日常操作。

## 快速开始

Docker Compose 是推荐入口。服务默认只监听本机回环地址。

```bash
docker-compose up --build -d
```

打开 `http://127.0.0.1:8080`，在设置页完成以下配置：

1. 启用或修改采集策略组。
2. 配置 GitHub Token 和 AI Provider API Key。
3. 填写飞书 App ID、App Secret 与群会话 `chat_id`。

运行数据保存在 `./data/`，包括 SQLite、运行配置和 secrets。该目录不会进入 Git。

## 本地开发

Python 3.13+ 与 Node.js 20+。

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
npm --prefix frontend install
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8080
```

另开一个终端启动前端开发服务器：

```bash
npm --prefix frontend run dev
```

## 默认策略组

首次启动提供三组默认关闭的示例策略，启用后才会请求 GitHub：

- AI Agent 项目：`agent OR llm OR "ai assistant"`
- Agent Skill 项目：`skill OR "claude code" OR codex`
- MCP 服务项目：`mcp OR "model context protocol"`

每组默认星标范围为 10–500，可在设置页调整。

## 安全

Compose 映射为 `127.0.0.1:8080:8080`。通过反向代理提供远程访问前，请自行限制访问来源。运行配置和密钥位于 `data/`，不要提交或公开该目录。

更多说明见 [架构文档](docs/architecture.md) 与 [安全说明](docs/security.md)。

## 开源协议

[MIT](LICENSE)
