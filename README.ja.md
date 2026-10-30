# DeepSeek Harness Plugins

[English](README.md) | 日本語 | [中文](README.zh.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用のオープンソースプラグイン集です。langify-org がメンテナンスしています。

## プラグイン

| パッケージ                                 | 説明                                             |
| ------------------------------------------ | ------------------------------------------------ |
| [`@langify-org/dsh-greet`](packages/greet) | `greet` ツールを登録する例兼雛形。公開しません。 |

## 導入

プラグインは DSH バンドルを宣言した npm パッケージです。DSH CLI でプロファイルに追加します。

```sh
dsh plugin --profile <profile> add @langify-org/dsh-<name>
```

DSH の Web 版や Desktop 版では **Plugins** ページから追加できます。対応する DSH の版は各パッケージの README に記載しています。

プラグインは DSH の Host プロセス内で、ユーザーの権限で動きます。導入する前に [SECURITY.ja.md](SECURITY.ja.md) を読んでください。

## 貢献

環境構築・開発の流れ・プラグインの追加方法は [CONTRIBUTING.ja.md](CONTRIBUTING.ja.md) を参照してください。

## ライセンス

[MIT](LICENSE)
