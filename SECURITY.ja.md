# セキュリティ

[English](SECURITY.md) | 日本語 | [中文](SECURITY.zh.md)

## プラグインにできること

DSH プラグインは DSH の Host プロセス内で、DSH を起動したユーザーの権限で動きます。DSH がエージェントのツールに適用するサンドボックスの制限は受けません。ソースを信頼できるプラグインだけを導入してください。

このリポジトリのパッケージはインストール時スクリプトを実行せず、ビルド済みファイルだけを含みます。そのソースはこのリポジトリにあります。

## プラグインごとの注意

- **[@langify-org/dsh-code-server](packages/code-server)** は、DSH の認証の内側で、DSH 自身のオリジンから code-server を配信します。code-server 自体は非公開の Unix socket でしか待ち受けません。code-server の中で動くコード（ターミナル、拡張、その webview）は、DSH のサンドボックスの外であなたとして動きます。さらに同一オリジンなので、あなたのセッションで DSH を操作することもできます。code-server の拡張を入れることは、DSH のプラグインを入れることと同じように扱ってください。

## 脆弱性の報告

脆弱性は [GitHub のセキュリティアドバイザリ](https://github.com/langify-org/deepseek-harness-plugins/security/advisories/new)から非公開で報告してください。公開の Issue は作らないでください。

該当するパッケージと版、DSH の版、再現手順を書いてください。
