# codebuddy-quota

OpenCode Desktop 的 CodeBuddy 企业订阅额度显示插件：会话标题行一个电池胶囊显示本周期剩余额度，
点开看详情。取数在插件自己的 server 端完成，不监听端口、不自启、不落盘。

```
CodeBuddy 上游 (HTTPS)
      ▲ POST
      │
OpenCode 服务进程
  └─ server.ts          取数、30 秒缓存、失败回落
        ▲
        │  RPC read({})
        ▼
Desktop 窗口
  └─ src/gui           胶囊 / 浮层
```

## 安装

`~/.config/opencode/opencode.jsonc` 的 `plugins` 里加这个目录的绝对路径：

```jsonc
{
  "plugins": ["D:\\code\\codebuddy-quota"]
}
```

新增本地插件后需要 `opencode service restart`。之后改 `src/gui/**` 只需 `bun run build`（窗口热重载），
改 `server.ts` / `src/server/**` 需要再重启一次服务。

## 凭据

只从环境变量 `OPENCODE_CODEBUDDY_API_KEY` 读取，读取点只有一个：`src/server/upstream.ts` 的 `readApiKey()`。
Key 不会进入窗口进程，也不会出现在 RPC 响应里。

## 开发

```bash
bun install
bun test          # 91 个用例
bun run build     # 产出 dist/gui-experimental.cjs
```

冒烟测试（需要服务在跑）：

```bash
opencode api post "/api/rpc/codebuddy-quota/read" -d '{"input":{}}'
```

## 结构

| 文件 | 职责 |
| --- | --- |
| `rpc.ts` | RPC 契约，纯 JSON Schema，server 与 GUI 共用 |
| `server.ts` | server 端入口，唯一出网点 |
| `src/server/upstream.ts` | 读 Key、请求上游、解析 |
| `src/server/quota-source.ts` | 30 秒缓存、并发合并、失败限流与回落 |
| `src/server/wire.ts` | 读数 → RPC 返回值的映射 |
| `src/gui/store.ts` | GUI 侧 RPC 客户端与刷新节流 |
| `src/gui/quota.ts` | 状态归类、百分比与节奏推导 |
| `src/gui/battery.tsx` / `dialog.tsx` | 胶囊与浮层 |

## 行为约定

- 状态三种：`ok`（实时）/ `stale`（有旧值但本次刷新失败）/ `error`（从未取到）。
- 上游失败后 30 秒内不再重试，避免多窗口把故障上游打成雪崩。
- 点「刷新」绕过 GUI 侧节流，但仍受 server 端 30 秒缓存约束——数字不变是预期。
- 窗口隐藏时停止轮询，恢复可见且数据超过 2 分钟才刷新。
