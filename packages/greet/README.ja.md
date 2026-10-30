# @langify-org/dsh-greet

[English](README.md) | 日本語 | [中文](README.zh.md)

`greet` ツールを登録する最小の DeepSeek Harness プラグインです。このリポジトリで新しいプラグインを作るときの雛形で、npm には公開しません。`pnpm dev` で動かしてください（[CONTRIBUTING.ja.md](../../CONTRIBUTING.ja.md) を参照）。

対応する DSH の版: `>=0.2.1-rc.3 <0.3.0-0`。

## ツール

| ツール  | 引数                   | 結果             |
| ------- | ---------------------- | ---------------- |
| `greet` | `name`（文字列、必須） | `Hello, <name>!` |

モデルへの指示の例: 「greet ツールで Ada に挨拶して」。

## 設定

なし。
