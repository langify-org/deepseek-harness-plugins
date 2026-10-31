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

包可以把仅用于开发的设置放在 `package.json` 旁边的 `dev.patch.yml` 中；`pnpm dev` 会应用它，而且它不会被发布。插件在 DSH 之外写入的内容，应在这里用 `!!js dshHomePath(...)` 指向 `.dsh/` 内部，例如 [`packages/code-server/dev.patch.yml`](packages/code-server/dev.patch.yml) 就这样处理了 code-server 的设置和扩展。

模型需要 API 密钥。请写入 `.envrc.local`，该文件被 git 忽略并由 direnv 加载：

```sh
export DEEPSEEK_API_KEY=...
```

也可以在设置页面配置其他提供商，相关配置同样保存在 `.dsh/` 中。删除 `.dsh/` 即可从头开始。

## 添加插件

1. 将 `packages/greet` 复制为 `packages/<name>`，把包名改为 `@langify-org/dsh-<name>`，删除 `"private": true`，并添加 `"publishConfig": { "access": "public" }`。同时更新 `repository.directory`、`homepage` 和 `description`。
2. 为 `cordis.patch.yml` 中的插件行的 id 加上 `langify-` 前缀，避免与其他 bundle 的行冲突。
3. 与 Host 共享的 DSH 包同时写入 `peerDependencies`（版本范围）和 `devDependencies`（`catalog:`）。新的 DSH 包需添加到 `pnpm-workspace.yaml` 的 catalog 中。
4. 使 `engines.dsh` 与该插件经过验证的版本范围保持一致。
5. 用英文、日文和中文编写 README，并将插件添加到根目录 README 的表格中。
6. 如果插件有浏览器部分，请用 [`tsdown.client.ts`](tsdown.client.ts) 中的 `clientBundle()` 构建 `src/client/index.tsx`，声明 `dsh.client`，并将 `./client` 导出为 `./dist/client.cjs`；类型检查通过 `typecheck` 脚本运行 `src/client/tsconfig.json`。示例见 [`packages/code-server`](packages/code-server)。

`pnpm dev` 和 `pnpm smoke` 会处理所有声明了 `dsh.bundle` 的包。

## 发布

1. 修改已发布包的拉取请求需要附带 changeset：运行 `pnpm changeset`，选择包和变更类型，并提交它生成的文件。
2. 在 `main` 上，Release workflow 会持续更新一个 **Version Packages** 拉取请求，用于提升版本并写入各包的 `CHANGELOG.md`。合并它后，CI 会把新版本发布到 npm（带 provenance，无需保存令牌）。
3. 新包的第一个版本由维护者发布，因为 npm 只有在包存在后才能信任 CI：先运行 `pnpm build`，再在包目录中运行 `pnpm publish`。然后在 npmjs.com 上，把本仓库的 `release.yml` workflow 添加为该包的 trusted publisher。

## 约定

- **类型**：共享的 `tsconfig.base.json` 采用严格设置，包括 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 和 `isolatedDeclarations`。导出的值需要显式类型，这样 tsdown 就能用 oxc 而不是 TypeScript API 生成类型声明（TypeScript 7 不提供该 API）。Host 代码和浏览器代码是两个独立的程序（根目录的 `tsconfig.json` 与各包的 `src/client/tsconfig.json`），因为 DSH 在同一个 Cordis `Context` 上为两侧声明了不同的服务。
- **先类型，后测试**：凡是编译器能检查的，都用类型表达：契约用 interface，取值集合用 union，必须覆盖所有成员的映射用 `Record<Union, …>`（code-server 的翻译就以这种方式覆盖了所有错误码），在每个信任边界上使用以该 interface 标注的运行时校验。只为类型无法表达的部分编写测试：时间、I/O、解析不可信输入、安全检查和协议的边界情况。不测试编译器已经保证的内容，也不测试一行的连线代码。测试名所描述的行为一旦被破坏，测试就必须失败。
- **集成**：`pnpm smoke` 检查 DSH 能否合成每个 bundle。需要浏览器或其他程序的检查步骤写在各包的 README 中。
- **Lint**：不在代码中内联抑制 lint 错误。当某条规则不适用于一整类文件时，修改 `.oxlintrc.json`，在那里用注释写明原因，并在拉取请求中说明。
- **包**：仅限 ESM。发布的包只包含构建产物，不运行安装脚本。
- **DSH 版本**：`pnpm-workspace.yaml` 中的 catalog 固定了开发和 CI 使用的 DSH 版本，即 `engines.dsh` 的下限。升级 DSH 时先修改 catalog，再修改各 `engines.dsh` 和 peer 范围。
- **文档**：以英文版为准。修改英文文档时，请在同一个拉取请求中更新 `.ja.md` 和 `.zh.md` 译文。
