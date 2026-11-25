# @langify-org/dsh-exa

[English](README.md) | [日本語](README.ja.md) | 中文

让 DeepSeek Harness 自带的 `web_search` 和 `web_fetch` 在 [Exa](https://exa.ai) 上运行。搜索和抓取都使用你的 Exa API 密钥发往 Exa，不涉及 DeepSeek 的 API 密钥或账号。模型看到的工具保持不变。

## 要求

- DSH `>=0.2.2-rc.5 <0.3.0-0`。
- Exa API 密钥，可在 [Exa 控制台](https://dashboard.exa.ai/api-keys)创建。

## 安装

```sh
dsh plugin --profile <profile> add @langify-org/dsh-exa
```

在 DSH Web 和桌面版中，也可以从 **Plugins** 页面添加。

## 配置

1. 把密钥放进启动 DSH 的环境中的环境变量 `EXA_API_KEY`：启动用的 shell，或 `$DSH_HOME/.env`。DSH 在启动时读取它，设置后请重启 DSH。
2. 为搜索和抓取都选择 Exa：在 **Plugins** → **Web search and fetch** 的两个菜单中选择 **Exa**，或写在配置档的 `cordis.patch.yml` 中：

   ```yaml
   - id: web
     name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: exa
       fetchProvider: exa
   ```

选定后，Exa 端的失败（例如余额耗尽时的 HTTP 402）会连同 Exa 的消息报告给模型，不会切换到其他 provider。

## 设置项

| 设置        | 默认值        | 含义                          |
| ----------- | ------------- | ----------------------------- |
| `apiKeyEnv` | `EXA_API_KEY` | 存放 Exa API 密钥的环境变量名 |

## 发送的内容

| 工具         | Exa 接口    | 发给 Exa 的内容  | 返回给模型的内容                                   |
| ------------ | ----------- | ---------------- | -------------------------------------------------- |
| `web_search` | `/search`   | 查询词和结果数量 | 标题、URL、发布日期，以及 Exa 从每个页面选出的段落 |
| `web_fetch`  | `/contents` | URL              | Exa 提取的页面文本及其 HTTP 状态                   |

Exa 按每次搜索和每个抓取的页面计费，见 [Exa 定价](https://exa.ai/pricing)。

## 限制

- 没有密钥时，两个 provider 都不可用；在它们被选中期间，所有搜索和抓取都会以 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` 失败。
- 读取页面的是 Exa 而不是 DSH：Exa 无法访问的页面（如 `localhost` 或内网）无法抓取，返回的正文是 Exa 转换的文本，而不是页面的 HTML。
