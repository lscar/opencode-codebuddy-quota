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

## 模型导入

插件每次启动会从 `https://copilot.tencent.com/v3/config` 拉取当前 Key 可用的模型清单，
写进 `~/.config/opencode/opencode.jsonc` 里 `codebuddy` provider 的 `models`。
清单跟着账号变，换 Key、开新模型都不用改配置。

- **只替换 `models` 这一段**，package、endpoint、apiKey、以及文件里其他任何键都不动；
  注释和排版也保留，写进去的每个模型是紧凑的单行，和你手写的样子一致。
- 写入前会把原文件备份成 `opencode.jsonc.codebuddy-quota.bak`。
- 内容没变化时不写文件（重复启动不会反复改盘）。
- 拉取失败、或配置解析不了时，一个字节都不写，只在控制台说明原因。
- 没有 `OPENCODE_CODEBUDDY_API_KEY` 时完全跳过，不会凭空建一个发不出请求的 provider。

改完需要重启 opencode 才会读到新模型（配置在 provider 解析之前读入）。

模型单价取自 OpenCode 本地缓存的 models.dev 数据（美元），不做汇率换算；额度本身按 credits
计费，所以这里的价格只用来让界面能显示花费，**不要当成真实账单**。
`credits` 为 `x0.00` 的模型按零价处理。

### 配置文件

可选，路径 `~/.config/opencode/codebuddy-quota.json`。只读不写，缺失时用内置默认值：

```json
{
  "model_aliases": { "hy4std": "hy4", "hy4free": "hy4" },
  "cost_providers": { "glm-5.3-flash": "zhipuai" },
  "default_cost_provider": "opencode",
  "excluded_models": ["space-bunny", "hy3", "hy3-x"],
  "auto_prefix": true
}
```

| 字段 | 作用 |
| --- | --- |
| `model_aliases` | CodeBuddy 的模型 id → models.dev 里的 id，同名不同版本时用 |
| `cost_providers` | 模型 id → 到哪个 models.dev provider 取价；这里写的会与默认映射合并，其余的默认项保留 |
| `default_cost_provider` | 上面都没命中时的兜底 provider |
| `excluded_models` | 完全不注入的模型 id，整体替换默认值 |
| `auto_prefix` | 按模型 id 前缀猜 provider（`glm-` → `zhipuai` 等）；关掉就一律用 `default_cost_provider` |

某个模型在 models.dev 里查不到价格时不会被猜成近似的同族模型（那里有一堆 `-free` 零价条目），
只会留空并在控制台报一次原因。

## 开发

```bash
bun install
bun test          # 182 个用例
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
| `src/server/config.ts` | 读 `codebuddy-quota.json`，返回合并且校验过的配置 |
| `src/server/catalog.ts` | 拉 `/v3/config`，按 `cli` 白名单解析模型清单 |
| `src/server/pricing.ts` | 模型 id → models.dev 价格 |
| `src/server/models-dev.ts` | 从 `opencode.db` 的 `kv` 表读 models.dev 缓存 |
| `src/server/model-info.ts` | 过滤、定价、同名去重，组装待写入的模型 |
| `src/server/config-writer.ts` | 把模型清单合并进 `opencode.jsonc`，保留其余内容 |
| `src/gui/store.ts` | GUI 侧 RPC 客户端与刷新节流 |
| `src/gui/quota.ts` | 状态归类、百分比与节奏推导 |
| `src/gui/battery.tsx` / `dialog.tsx` | 胶囊与浮层 |

## 行为约定

- 状态三种：`ok`（实时）/ `stale`（有旧值但本次刷新失败）/ `error`（从未取到）。
- 上游失败后 30 秒内不再重试，避免多窗口把故障上游打成雪崩。
- 点「刷新」绕过 GUI 侧节流，但仍受 server 端 30 秒缓存约束——数字不变是预期。
- 窗口隐藏时停止轮询，恢复可见且数据超过 2 分钟才刷新。
