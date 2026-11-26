# opencode-codebuddy-quota

OpenCode 插件：在状态栏显示 CodeBuddy 额度胶囊，并把 CodeBuddy 的模型接入模型选择器。

支持 **国内站**（`copilot.tencent.com`）与 **国际站**（`www.codebuddy.ai`），两站各自登录、各自额度、在一个弹窗里切换。

## 功能

- **额度胶囊**：会话标题栏显示本周期剩余积分、使用节奏（快于/慢于时间）、到期/重置时间；需要登录时显示琥珀色角标。
- **额度弹窗**：点击胶囊打开，可切换国内/国际站、手动刷新、登录。样式跟随 OpenCode 主题，带克制的柔光与动效。
- **模型接入**：按 WorkBuddy 客户端逻辑从 `/v3/config` 自动生成模型清单——国际站过滤 Pro-only 模型、同名模型保留免费版、名称标注倍率；国内站同理。模型数据随上游自动更新，不写死。
- **内置代理**：本地 `127.0.0.1:7688`，按 `/cn/v2`、`/intl/v2` 选站并注入 JWT；国际站自动补齐渠道校验头与身份提示词。
- **自包含登录**：浮层点「登录」→ 浏览器授权 → 轮询获取凭据，写入自己的缓存，不依赖 CodeBuddy CLI，也不读写 CLI 的认证文件。
- **JWT 自动刷新**：凭据过期前自动续期；失败冷却、登录后强制回填额度等边界均已处理。

## 安装

在 OpenCode 全局配置（`~/.config/opencode/opencode.jsonc` 或 `.json`）里加入本插件：

```jsonc
{
  "plugins": ["opencode-codebuddy-quota"]
}
```

固定版本时写成 `"opencode-codebuddy-quota@<version>"`。

插件首次运行会把模型写入 provider `codebuddy-cn` / `codebuddy-intl`；在 `/model` 里选择对应模型即可对话。

## 登录

1. 点击状态栏的额度胶囊打开弹窗。
2. 在需要登录的站点标签上点「登录」，浏览器会打开授权页。
3. 完成授权后插件自行轮询获取凭据，胶囊与弹窗自动刷新。

凭据缓存位于 `~/.config/opencode/codebuddy-quota-v2-auth.json`，可删除后重新登录。

## 配置

高级映射配置位于 `~/.config/opencode/codebuddy-quota-v2.json`（可选）：

```jsonc
{
  "models": {
    "<codebuddy-id>": { "provider": "<models.dev-provider>", "model": "<model-id>" }
  },
  "excluded_models": ["space-bunny", "hy3", "hy3-x", "auto", "max-model"],
  "package_version": "2.0.90"
}
```

- `models`：CodeBuddy 模型 id → models.dev 坐标；未映射的模型不会进入选择器。
- `excluded_models`：硬排除的模型 id（含虚拟路由档位 `auto` / `max-model`）。
- `package_version`：写入 provider 的 `@ai-sdk/openai-compatible` 版本。

默认配置见 `config.default.json`。

## 开发

前置：本机有 `bun`。

```sh
bun install
bun run check        # typecheck + 全部测试
bun run build:gui    # 构建桌面端 GUI（dist/gui-experimental.cjs）
```

插件由三部分构成（同一个 npm 包）：

- `server.ts` / `src/server/*`：额度取数、模型导入、本地代理、RPC。
- `src/gui.tsx` / `src/gui/*`：桌面端 GUI（状态栏胶囊与弹窗），SolidJS。
- `rpc.ts`：服务端与 GUI 之间的契约。

## 限制

- 每站本期至多一个账号；数据结构预留了多账号，但本期不提供切换 UI。
- 本地代理是 "confused deputy"：本机任意进程都能借它用 JWT 调上游，接受此风险。
- 模型倍率名称来自上游 `credits` 字段；上游未声明时倍率标签会省略。

## License

MIT
