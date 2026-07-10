# 架构说明

RepoRadar 由 GitHub 采集、AI 项目介绍、飞书群聊通知和三页 Web 控制台组成。

- SQLite 保存仓库、策略游标、冷却记录、分析结果、通知去重和运行事件。
- GitHub 仓库 ID 是唯一键；策略只记录仓库来源，不创建重复记录。
- 服务启动后从 `data/` 读取运行配置和 secrets。首次启动会以 `config.example.yml` 创建配置文件。
- Docker Compose 将服务只映射到本机回环地址。需要远程访问时，应由部署者在反向代理层配置访问控制。
