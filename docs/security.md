# 安全与数据目录

`data/` 保存 GitHub Token、AI Provider 密钥、飞书应用凭证、运行配置和 SQLite 数据库，已被 Git 忽略。

服务的写接口假设运行在本机受控环境。Docker Compose 默认仅绑定 `127.0.0.1`。通过反向代理暴露服务前，应先限制访问来源。
