# DeepSeek Harness Plugins

English | [日本語](README.ja.md) | [中文](README.zh.md)

Open-source plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), maintained by langify-org.

## Plugins

| Package                                                | Description                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [`@langify-org/dsh-browser`](packages/browser)         | A Chromium on the host in right-sidebar tabs, shared with the model, that keeps running with no page open. |
| [`@langify-org/dsh-code-server`](packages/code-server) | Edit the session's working folder in code-server inside DSH.                                               |
| [`@langify-org/dsh-greet`](packages/greet)             | Example and template that registers a `greet` tool. Not published.                                         |
| [`@langify-org/dsh-side-chat`](packages/side-chat)     | Ask a side question beside a conversation, in a fork shown in the right sidebar.                           |
| [`@langify-org/dsh-tasks`](packages/tasks)             | Run justfile recipes from a Tasks tab in the right sidebar, in a terminal tab.                             |
| [`@langify-org/dsh-tmux`](packages/tmux)               | A terminal tab per conversation on tmux, shared with the model, that outlives reloads and restarts.        |

## Install

Plugins are npm packages that declare a DSH bundle. Add one to a profile with the DSH CLI:

```sh
dsh plugin --profile <profile> add @langify-org/dsh-<name>
```

In DSH Web or Desktop, use the **Plugins** page instead. Each package's README lists the DSH versions it supports.

Plugins run inside the DSH host process with your user's permissions. Read [SECURITY.md](SECURITY.md) before installing.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the development loop, and how to add a plugin.

## License

[MIT](LICENSE)
