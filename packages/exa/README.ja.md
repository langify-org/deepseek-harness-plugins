# @langify-org/dsh-exa

[English](README.md) | 日本語 | [中文](README.zh.md)

DeepSeek Harness の `web_search` と `web_fetch` を [Exa](https://exa.ai) で動かします。検索も本文の取得も、Exa の API キーで Exa に送ります。DeepSeek の API キーやアカウントは使いません。モデルから見えるツールは変わりません。

## 必要なもの

- DSH `>=0.2.2-rc.5 <0.3.0-0`。
- Exa の API キー。[Exa の dashboard](https://dashboard.exa.ai/api-keys) で作れます。

## インストール

```sh
dsh plugin --profile <profile> add @langify-org/dsh-exa
```

DSH の Web 版とデスクトップ版では、**Plugins** ページからも追加できます。

## 設定のしかた

1. キーを、DSH を起動する環境の環境変数 `EXA_API_KEY` に入れます（起動するシェルか `$DSH_HOME/.env`）。DSH は起動時に読むので、入れたら DSH を再起動します。
2. 検索と取得の両方で Exa を選びます。**Plugins** → **Web search and fetch** の 2 つのメニューで **Exa** を選ぶか、プロファイルの `cordis.patch.yml` に書きます。

   ```yaml
   - id: web
     name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: exa
       fetchProvider: exa
   ```

選んだあとは、Exa 側の失敗（残高切れの HTTP 402 など）を Exa のメッセージのままモデルに伝えます。別の provider には切り替えません。

## 設定項目

| 設定        | 既定値        | 何か                                  |
| ----------- | ------------- | ------------------------------------- |
| `apiKeyEnv` | `EXA_API_KEY` | Exa の API キーが入った環境変数の名前 |

## 何を送るか

| ツール       | Exa の API  | Exa に送るもの     | モデルに返るもの                                       |
| ------------ | ----------- | ------------------ | ------------------------------------------------------ |
| `web_search` | `/search`   | 検索語と結果の件数 | タイトル・URL・公開日と、各ページから Exa が選んだ箇所 |
| `web_fetch`  | `/contents` | URL                | Exa が取り出したページのテキストと、HTTP のステータス  |

料金は、検索 1 回ごと・取得したページ 1 つごとに Exa が請求します（[Exa の料金](https://exa.ai/pricing)）。

## 制限

- キーがないと、2 つの provider はどちらも使えません。選んだままだと、検索と取得はすべて `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` で失敗します。
- ページを読むのは DSH ではなく Exa です。`localhost` や社内ネットワークなど Exa から届かないページは取得できません。返る本文はページの HTML ではなく、Exa がテキストにしたものです。
