# @langify-org/dsh-workbench

[English](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/workbench/README.md) | 日本語 | [简体中文](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/workbench/README.zh.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）で、会話を始める前に、名前を付けた作業場所を作ります。作業場所は独立したワークスペースとして登録された git worktree で、空のセッションと右サイドバーのターミナルがすぐ使える状態で開きます。作業が終わったら削除できます。

## ステータス

試作段階です。npm には公開しておらず、動作も設定も今後変わります。設計と、試作でわかったことは [DESIGN.md](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/workbench/DESIGN.md)（英語）にあります。

## 試してみる

このリポジトリのチェックアウトから、プラグインを読み込んだ開発用の DSH を起動します。あなた自身の DSH には触れず、作業場所は `.dsh-dev/workbenches/` の下に作られます。

```sh
just dev-use-profile
just dev workbench
```

セッションで右サイドバーを開き、スタートページの **Workbench** を選び、名前を入力して **Create & open** を押します。
