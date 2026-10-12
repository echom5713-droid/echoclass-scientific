# DeepSeek API 接入说明

这个版本已经把 `/api/llm/ask` 接到了服务器端 DeepSeek 代理。前端不会接触 API Key。

## 你需要填写的内容

在项目根目录把 `.env.example` 复制成 `.env`，然后只需要改这一行：

```env
DEEPSEEK_API_KEY=
```

其余几行可以先不改：

```env
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_API_TIMEOUT_MS=20000
```

如果端口 3000 被占用，可以在 `.env` 里加：

```env
PORT=3001
```

## 本地运行

```bash
npm run dev
```

打开：

```text
http://localhost:3000/llm-teaching
```

或者进入习题页底部的“AI 实时讲解”。

## 检查是否配置成功

浏览器打开：

```text
http://localhost:3000/api/llm/status
```

如果看到：

```json
{ "configured": true }
```

说明服务器已经读到 DeepSeek Key。

## 服务器 / PM2 部署

推荐方式：项目根目录保留 `.env`，然后执行：

```bash
npm run start
```

如果用 PM2：

```bash
pm2 start npm --name echoclass -- start
pm2 save
```

重启后仍然会自动读取项目根目录的 `.env`。

## 重要安全提醒

1. 不要把 DeepSeek API Key 写进 `public/client.js`。
2. 不要把 `.env` 上传 GitHub。
3. 不要把 `.env` 发给队友或评委。
4. 如果泄露了 Key，要去 DeepSeek 后台重新生成。

## 当前逻辑

- 配置了 Key：优先请求 DeepSeek。
- 没配置 Key 或 DeepSeek 临时失败：返回明确标注的本地兜底讲解。
- 用户问题限长 2,000 字符，每个 IP/会话每分钟最多 10 次；常见邮箱、手机号、账号和长数字 ID 在请求前脱敏。
- AI 输出只是辅助解释，不能自动决定实验数据是否排除。
