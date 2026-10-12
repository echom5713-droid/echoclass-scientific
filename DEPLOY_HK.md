# 香港服务器部署建议

本文件是运维参考，不代表已部署或通过生产评估。当前先在隔离环境验证；公开上线仍需完成项目风险登记中的人工事项。

## 推荐环境

- Ubuntu 22.04 / 24.04
- Node.js 24（与项目 engines、CI 一致）
- PM2
- Nginx
- HTTPS 证书

## 1. 启动应用

```bash
npm ci
npm run build
npm run smoke-test
pm2 start npm --name echoclass -- run start
pm2 save
pm2 startup
```

构建使用锁定依赖，运行时包含 CSV 解析与输出库。不要省略构建步骤，也不要在真实数据目录开启合成演示账号。

## 2. Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    client_max_body_size 5m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static/ {
        proxy_pass http://127.0.0.1:3000;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
    }
}
```

## 3. 大陆访问稳定性检查清单

- 不使用 Google Fonts
- 不使用外部 JS/CSS CDN
- 不使用外部图片 URL
- 不让浏览器直连 DeepSeek / OpenAI / Supabase
- `/api/health` 可访问
- `/api/records` 可读写
- `/api/llm/ask` 即使没有模型密钥也有本地兜底
- 学生端断网提交可进入本地离线队列

## 4. 数据备份

SQLite 与附件默认位于数据目录；`ECHOCLASS_DATA_DIR` 可指定另一绝对目录。附件不放进静态资源目录。备份需要同时保留数据库与它引用的全部文件，包括已归档附件。

```text
data/citrus.db
data/evidence/objects/
```

创建到一个尚不存在的备份目录，成功后再按需复制到另一可靠设备：

```bash
mkdir -p backups
npm run backup -- ./backups/verified-copy
```

恢复必须使用另一个尚不存在的数据目录，不能覆盖正在运行的数据：

```bash
npm run restore -- ./backups/verified-copy ./restored-data
```

命令验证成功后，停止原进程，再将 `ECHOCLASS_DATA_DIR` 指向恢复目录启动。保留 `RESTORE_IN_PROGRESS` 的目录不可启动；失败恢复应排查原因并换一个新目录重试。禁止复制一个仍在写入的主 DB 文件来替代 SQLite 快照。

这份备份只覆盖 SQLite 和 evidence。练习答案 `practice_answers.json`、部署配置、密钥和外部素材需分别处理；不能把这条命令称为完整主机备份。详细范围见 [证据与恢复合同](docs/milestone-2b-2-plan.md)。

## 5. 存储边界

真实 CSV、文件证据和封存分析依赖 SQLite；显式 JSON 模式只供有限兼容用途，不是数据库故障时可自动降级的等价存储。数据库适配、并发与备份策略的变化需要独立验证。
