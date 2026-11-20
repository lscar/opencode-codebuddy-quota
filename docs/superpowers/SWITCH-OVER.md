# CodeBuddy Quota V2 切换清单

开发期新旧插件**并行共存**；只有新插件全部验证通过后，才按本文**手动**切换到 V2。
切换涉及改用户的 `~/.config/opencode/opencode.jsonc` 和插件注册，属于危险操作——
**执行前先备份、逐步确认，不要一次性全删。**

## 并行期状态（当前）

- 旧插件 `opencode-codebuddy-quota` 与旧 provider `codebuddy` 原样运行，会话/胶囊/对话均不受影响。
- 新插件 `opencode-codebuddy-quota-v2` 追加注册，新增 provider `codebuddy-cn` / `codebuddy-intl`，两胶囊在 `session.header` 并存。
- 新插件自包含登录：浮层点「登录」→ 浏览器授权 → 轮询 `auth/token` → 写自己的缓存 `~/.config/opencode/codebuddy-quota-v2-auth.json`；不读、不写 CLI 的 auth 文件。
- 本地代理 `127.0.0.1:7688`，按 `/cn/v2`、`/intl/v2` 选站并注入 JWT。

## 切换前置条件（全部打勾才动手）

- [ ] 两站都能在浮层登录成功，胶囊显示正确余量。
- [ ] 模型选择器出现 `codebuddy-cn`（国内 cli 白名单数）和 `codebuddy-intl`（国际 cli 白名单数），数量与 CodeBuddy `/model` 一致；无图像/视频/旧版模型。
- [ ] 选中两站模型分别发对话，流式正常返回。
- [ ] 浮层 `[国内][国际]` 切换，胶囊跟随；重启 opencode 后选择保持。
- [ ] 人为把缓存某站 `expiresAt` 改过去，代理自动 refresh 成功、连续刷新不失败。
- [ ] 无认证/过期时登录按钮与胶囊角标按预期出现，登录后消失。
- [ ] `bun run check` 与 `bun run build:gui` 均通过。

## 切换步骤（手动）

1. **备份用户配置**：复制 `~/.config/opencode/opencode.jsonc` 为 `opencode.jsonc.manual-backup`（新插件自己的 `.codebuddy-quota-v2.bak` 由 writer 自动留底，但手工整份备份更稳）。
2. **停掉旧插件**：从 `opencode.jsonc` 的 `plugins` 数组移除旧插件路径，只保留新插件路径。
3. **重启 opencode**，确认只剩新插件的胶囊，且能正常对话与切换站点。
4. **观察一个完整周期**（含一次 JWT 过期刷新）：无异常后，再清理旧 provider。
5. **清理旧 provider `codebuddy`**：确认没有任何会话/配置引用它之后，才从 `opencode.jsonc` 的 `providers` 删除 `codebuddy` 块及其 models；保留手工备份。
6. **确认无需 CodeBuddy CLI**：本机即使卸载 CodeBuddy CLI，新插件仍能用浮层登录、对话、取额度。

## 回滚

任一步异常，立刻：
- 从 `opencode.jsonc.manual-backup` 恢复配置；
- 恢复旧插件路径到 `plugins`；
- 重启 opencode。
新插件的缓存文件 `codebuddy-quota-v2-auth.json` 可保留（无害）或删除后重新登录。

## 已知限制 / 非目标

- 不做每日用量折线图：JWT 拿不到网页每日明细（只认网页 session cookie），企业管理 `/api/v1/...` 只认 `pt_` key。另立议题。
- 每站本期至多一个账号；缓存结构已预留每站多账号 + 切换，但本期不实现多账号 UI。
- 本地代理是「confused deputy」：本机任意进程都能借它用 JWT 调上游，接受此风险。
