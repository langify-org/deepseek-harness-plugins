# 贡献指南

[English](CONTRIBUTING.md) | [日本語](CONTRIBUTING.ja.md) | 中文

## 环境搭建

使用 [Nix](https://nixos.org) 和 [direnv](https://direnv.net) 时：

```sh
direnv allow
pnpm install
```

不使用 Nix 时，请安装 [`.node-version`](.node-version) 中指定版本的 Node.js 官方构建，以及 pnpm 11（`package.json` 中 `packageManager` 的版本）。DSH 无法在从源码编译的 Node（例如 nixpkgs 的 `nodejs`）上启动，因此 dev shell 使用官方二进制文件。

## 命令

| 命令              | 作用                                                            |
| ----------------- | --------------------------------------------------------------- |
| `pnpm check`      | 按顺序运行 CI 的全部检查。提交拉取请求前请先运行。              |
| `pnpm dev`        | 启动链接了所有插件的 DSH Web，并在代码变更时重新加载插件。      |
| `pnpm format`     | 使用 oxfmt 格式化文件。                                         |
| `pnpm lint`       | 使用 oxlint 进行基于类型信息的 lint。                           |
| `pnpm typecheck`  | 使用 TypeScript 7（tsgo）进行类型检查。                         |
| `pnpm test`       | 使用 Vitest 运行单元测试。                                      |
| `pnpm build`      | 使用 tsdown 构建所有包。                                        |
| `pnpm publint`    | 检查各包的发布形态。                                            |
| `pnpm docs:check` | 检查每份文档是否都有日文和中文翻译。                            |
| `pnpm smoke`      | 将所有插件安装到临时 DSH 主目录，并检查其 bundle 层是否被合成。 |

pre-commit 钩子（lefthook）会格式化并 lint 已暂存的文件。

## 开发流程

`pnpm dev` 将 DSH 的状态保存在 `.dsh/` 中，与你日常使用的 DSH 分开。它会构建各包，将其链接到该目录下的 `web` profile，然后启动 `tsdown --watch` 和 DSH Web。保存源文件后，包会被重新构建，DSH 的 HMR 无需重启即可替换正在运行的插件。`pnpm dev` 之后的参数会传给 `dsh web`，例如 `pnpm dev --port 3081`。

模型需要 API 密钥。请写入 `.envrc.local`，该文件被 git 忽略并由 direnv 加载：

```sh
export DEEPSEEK_API_KEY=...
```

也可以在设置页面配置其他提供商，相关配置同样保存在 `.dsh/` 中。删除 `.dsh/` 即可从头开始。

## 添加插件

1. 将 `packages/greet` 复制为 `packages/<name>`，把包名改为 `@langify-org/dsh-<name>`，并删除 `"private": true`。同时更新 `repository.directory`、`homepage` 和 `description`。
2. 为 `cordis.patch.yml` 中的插件行的 id 加上 `langify-` 前缀，避免与其他 bundle 的行冲突。
3. 与 Host 共享的 DSH 包同时写入 `peerDependencies`（版本范围）和 `devDependencies`（`catalog:`）。新的 DSH 包需添加到 `pnpm-workspace.yaml` 的 catalog 中。
4. 使 `engines.dsh` 与该插件经过验证的版本范围保持一致。
5. 用英文、日文和中文编写 README，并将插件添加到根目录 README 的表格中。

`pnpm dev` 和 `pnpm smoke` 会处理所有声明了 `dsh.bundle` 的包。

## 约定

- **类型**：共享的 `tsconfig.base.json` 采用严格设置，包括 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和 `isolatedDeclarations`。导出的值需要显式类型，这样 tsdown 就能用 oxc 而不是 TypeScript API 生成类型声明（TypeScript 7 不提供该 API）。
- **Lint**：不在代码中内联抑制 lint 错误。当某条规则不适用于一整类文件时，修改 `.oxlintrc.json` 并在拉取请求中说明原因。
- **测试**：不启动 DSH，直接测试插件逻辑。与 DSH 的集成由 `pnpm smoke` 负责。
- **包**：仅限 ESM。发布的包只包含构建产物，不运行安装脚本。
- **DSH 版本**：`pnpm-workspace.yaml` 中的 catalog 固定了开发和 CI 使用的 DSH 版本，即 `engines.dsh` 的下限。升级 DSH 时先修改 catalog，再修改各 `engines.dsh` 和 peer 范围。
- **文档**：以英文版为准。修改英文文档时，请在同一个拉取请求中更新 `.ja.md` 和 `.zh.md` 译文。
