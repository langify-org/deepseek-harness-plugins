# @langify-org/dsh-exa

English | [日本語](README.ja.md) | [中文](README.zh.md)

Runs DeepSeek Harness's own `web_search` and `web_fetch` on [Exa](https://exa.ai). Both go to Exa with your Exa API key; no DeepSeek API key or account is involved. The tools the model sees stay the same.

## Requirements

- DSH `>=0.2.2-rc.2 <0.3.0-0`.
- An Exa API key, from the [Exa dashboard](https://dashboard.exa.ai/api-keys).

## Install

```sh
dsh plugin --profile <profile> add @langify-org/dsh-exa
```

In DSH Web and Desktop you can also add it from the **Plugins** page.

## Setup

1. Put the key in the environment variable `EXA_API_KEY` where DSH starts: the launching shell, or `$DSH_HOME/.env`. DSH reads it at start, so restart DSH after setting it.
2. Select Exa for both search and fetch. Choose **Exa** in both menus of **Plugins** → **Web search and fetch**, or set them in the profile's `cordis.patch.yml`:

   ```yaml
   - id: web
     name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: exa
       fetchProvider: exa
   ```

Once selected, a failure at Exa, such as an exhausted balance (HTTP 402), is reported to the model with Exa's message. Nothing falls back to another provider.

## Settings

| Setting     | Default       | What it is                                          |
| ----------- | ------------- | --------------------------------------------------- |
| `apiKeyEnv` | `EXA_API_KEY` | The environment variable that holds the Exa API key |

## What it sends

| Tool         | Exa endpoint | What goes to Exa                    | What comes back to the model                                             |
| ------------ | ------------ | ----------------------------------- | ------------------------------------------------------------------------ |
| `web_search` | `/search`    | The query and the number of results | Title, URL, publication date, and the passages Exa picked from each page |
| `web_fetch`  | `/contents`  | The URL                             | The page's text as Exa extracted it, and its HTTP status                 |

Exa bills each search and each fetched page; see [Exa's pricing](https://exa.ai/pricing).

## Limitations

- Without a key, both providers are unavailable; while they are selected, every search and fetch fails with `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
- Exa reads the page, not DSH: pages Exa cannot reach, such as `localhost` or a private network, cannot be fetched, and the body is Exa's text rendering, not the page's HTML.
