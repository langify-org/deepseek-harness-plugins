# @langify-org/dsh-greet

English | [日本語](README.ja.md) | [中文](README.zh.md)

A minimal DeepSeek Harness plugin that registers a `greet` tool. It is the template for new plugins in this repository and is not published to npm; run it with `pnpm dev` (see [CONTRIBUTING.md](../../CONTRIBUTING.md)).

Supported DSH versions: `>=0.2.1-rc.3 <0.3.0-0`.

## Tool

| Tool    | Arguments                 | Result           |
| ------- | ------------------------- | ---------------- |
| `greet` | `name` (string, required) | `Hello, <name>!` |

Ask the model, for example: "Use the greet tool to greet Ada."

## Configuration

None.
