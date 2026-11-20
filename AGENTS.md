# 项目约定（给写代码的 AI 和人看）

这是一个 OpenCode Desktop 插件：显示 CodeBuddy 额度，并把 CodeBuddy 的模型写进用户的
`opencode.jsonc`。凡是要改这个仓库的行为，先读这一页。

## 提交前必须跑

```bash
bun run check      # = bunx tsc --noEmit && bun test
bun run build:gui  # 改了 src/gui/** 才需要
```

- 两条都绿才提交。`tsc` 覆盖 `server.ts`、`rpc.ts`、`vite.config.ts` 和整个 `src/`，
  **不要**为了让报错消失去改 `tsconfig.json` 的 `include`。
- 不许说"改好了/测试通过"而没真跑过。失败就贴真实输出。
- 修 bug 先写一条能复现的失败用例，再改实现，最后让那条用例通过。

## 这个仓库里最容易出错的地方

1. **写用户配置是危险操作。** `src/server/config-writer.ts` 改的是用户真实的
   `~/.config/opencode/opencode.jsonc`。任何改动都必须保住这四条不变量：
   - `stripComments()` 的结果**长度必须与输入一致**（所有 splice 偏移都依赖它）；
   - 定位必须按 JSON 结构走，不能在全文中 `indexOf` 一个键名——`"codebuddy"`、
     `"package"` 都可能出现在别的 provider 的字符串值或嵌套对象里；
   - 写盘前必须 `JSON.parse` 自检，并确认 `models` 落在 `providers.codebuddy` 下；
   - 任何一步不确定就返回 `skipped` 并说明原因，宁可不写。
2. **版本号只走 `isVersion()`。** 进到 `package` 的值永远先校验；历史事故就是整个文件被当成
   版本号写进了 `package`。`packageSpec()` 对非法值抛错，不要绕过它。
3. **价格和档位只来自 models.dev 原厂数据**，不做模糊匹配（catalog 里有一堆 `-free` 零价条目），
   也不做汇率换算。`limit` 固定 `context 500000 / output 64000`。
4. **`DEFAULT_CONFIG` 与 `config.default.json` 必须一致**，`config.test.ts` 会比对；
   改了一边就得改另一边。
5. **`package_version` 与 `package.json` 的 `version` 不是一回事**：前者是要写进用户配置的
   `@ai-sdk/openai-compatible` 版本。

## 代码风格

- TypeScript strict，不加 `any`、不加 `@ts-ignore`。测试里的对象要用真实类型
  （`CatalogModel` / `ImportedModel`），不要用 `as any` 绕过去。
- 注释解释**为什么**，不解释是什么；过时的注释比没有注释更糟，改逻辑时同步改注释。
  代码里一律用英文注释，用户可见文案用中文。
- 一个文件一个职责。测试与源文件同目录（`foo.ts` 旁边是 `foo.test.ts`）；
  新加测试文件时，不要用不存在的模块名命名。
- 不引入新依赖，除非确实不能再少了；先看 `package.json` 里已有的。

## 不要做的事

- 不要启动常驻的 `opencode-cli.exe serve`。
- 不要改 `~/.config/opencode/opencode.jsonc` 来"测试"——用 `writeModels` 的
  `readFile`/`writeFile` 注入在内存里测。
- 不要手工往仓库里放 `_repro.ts`、`_probe*.ts` 之类的临时脚本；用完即删，
  或直接写成正式用例。
- 不要重排无关代码、不要顺手"美化"格式，一次提交只做一件事。
