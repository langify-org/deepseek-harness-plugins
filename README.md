# DeepSeek Harness Plugins

English | [日本語](README.ja.md) | [中文](README.zh.md)

Open-source plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), maintained by langify-org.

## Plugins

| Package                                      | Description                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`@langify-org/dsh-memory`](packages/memory) | A memory directory that a scribe agent keeps up to date from every conversation.                    |
| [`@langify-org/dsh-tasks`](packages/tasks)   | Run justfile recipes from a Tasks tab in the right sidebar, in a terminal tab.                      |
| [`@langify-org/dsh-tmux`](packages/tmux)     | A terminal tab per conversation on tmux, shared with the model, that outlives reloads and restarts. |

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
