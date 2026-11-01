# @langify-org/dsh-code-server

[English](README.md) | 日本語 | [中文](README.zh.md)

DeepSeek Harness のセッションの作業フォルダーを、DSH の右サイドバーの中で [code-server](https://github.com/coder/code-server) を使って編集できます。DSH 内のテキストファイルへのリンクは、このエディターの該当行で開きます。

## 必要なもの

- DSH `>=0.2.1-rc.3 <0.3.0-0`（Linux または macOS）。
- 別途インストールした code-server。4.143 で検証しています。起動と停止はプラグインが行うので、自分で動かす必要はありません。
- セッションのファイルが DSH の動いているマシン上にあること。サンドボックスなど別のファイルシステム上のセッションは拒否します。

## 導入

```sh
dsh plugin --profile <profile> add @langify-org/dsh-code-server
```

DSH の Web 版や Desktop 版では **Plugins** ページから追加できます。

## 使い方

右サイドバーでタブを追加し、**Code** を選びます。セッションの作業フォルダーが開きます。初回は code-server の起動に数秒かかります。DSH の他の場所（**Workspace files** や会話中のリンクなど）でテキストファイルを選ぶと、Code ページに表示されます。画像や PDF などは DSH の標準のビューアーで開きます。

- エディターがつながっている間の知らせは、エディターに出ます。ステータスバーに接続状態を示す **DSH** が表示され、クリックすると**再接続**か接続のログを選べます。開けなかったファイルもエディターに知らせが出ます。セッションの作業フォルダーが変わると、新しいフォルダーで開き直すかを尋ねる通知が出ます。
- エディターから再接続すると、保存していない変更があれば先に保存を求め、そのあとエディターを再読み込みします。再接続前に選んだファイルは開き直しません。
- ページが表示するのは、エディターが知らせられないときだけです。code-server の起動中や起動失敗、接続が終わったあとです。接続が終わってもエディターは残り、上に**再接続**が出ます。DSH のタブの再読み込みコマンドでも同じです。
- エディターが時間内に確認しなかったファイルの表示要求は「結果不明」として報告し、再送しません。エディターが後から表示する可能性があるためです。

## 設定

| 設定            | 既定値        | 意味                                                           |
| --------------- | ------------- | -------------------------------------------------------------- |
| `command`       | `code-server` | 実行ファイルの名前またはパス。                                 |
| `userDataDir`   | 空            | code-server の `--user-data-dir`。空なら code-server の既定。  |
| `extensionsDir` | 空            | code-server の `--extensions-dir`。空なら code-server の既定。 |

既定のままなら、普段使いの code-server と設定・拡張を共有します。同じディレクトリを使う別の code-server を同時に動かさないでください。

## 仕組み

- プラグインは必要になったときに DSH 用の code-server を1つ起動します。待ち受けは本人だけが開ける Unix socket（`0700` のディレクトリ内の `0600`）で、code-server 自身の認証は無効にしています。ネットワークのポートは開きません。
- DSH は自分のオリジンの `/code-server` で code-server を配信します。すべてのリクエストと WebSocket は、先に DSH の認証とオリジンの検査を通ります。そのため code-server には、DSH に届く場所（Tailscale 経由など）からだけ届きます。
- DSH Desktop のページは `dsh-app://app` にあり、code-server はその宛先に WebSocket をつなごうとします。中継は code-server のページに小さなスクリプトを差し込み、WebSocket を Desktop が示す Host の宛先（`__DSH_TRANSPORT__.streamBaseUrl`）に付け替えます。Desktop はそこへの接続に DSH の認証情報を付けます。ブラウザーではこのスクリプトは何もしません。
- 起動のたびに、同梱の VS Code 拡張 **DSH Code Bridge**（`langify-org.dsh-code-bridge`）を code-server に入れ、古いものを置き換えます。
- Code ページごとに専用の接続（binding）を作ります。ページは binding をエディターの URL の断片（サーバーには送られない部分）に入れ、そのエディター画面の拡張がそれを読み取って、別の非公開 socket でプラグインに接続します。同じフォルダーを複数のページで開いていても、ファイルはその画面にだけ開きます。

## セキュリティ

code-server とそのターミナル・拡張は、あなたの権限で、DSH のサンドボックスや承認の外で動きます。さらに DSH と同じオリジンなので、code-server の中で動くコード（拡張やその webview を含む）は、あなたのセッションで DSH を操作することもできます。信頼できる拡張だけを入れてください。[SECURITY.ja.md](../../SECURITY.ja.md) も参照してください。

## 手動確認

ブラウザーと実際の code-server が必要なため、`pnpm check` には含めていません。リリース前に `pnpm dev` で確認します。`pnpm dev` では [dev.patch.yml](dev.patch.yml) により、code-server の設定と拡張は `.dsh/code-server/` に置かれ、普段の code-server とは分かれます。Host とページの変更は `pnpm dev` の実行中に反映されますが、`src/extension/` の変更は `pnpm dev` を起動し直すまで反映されません。code-server が拡張を入れるのは起動時だけだからです。

1. **Code** にはエディターだけが表示され、上に何も出ない。エディターのステータスバーの **DSH** が接続済みになる（Restricted Mode でも）。接続が終わった後もエディターは残り、上の行に**再接続**が出る。
2. **Workspace files** で選んだテキストファイルが Code ページの該当行で開く。画像は DSH のビューアーのまま開く。
3. サインインしていないと `/code-server/` と `POST /api/langify-code-server/create` が 401 を返し、別オリジンからの WebSocket の upgrade は 403 を返す。
4. セッションの作業フォルダーが変わると、エディターが開き直すかを尋ねる。未保存のファイルがあれば先に保存を求め、そのあとページが新しいフォルダーでエディターを開き直す。
5. Code タブを閉じると binding が閉じる。DSH を止めると code-server も止まり、socket が消える。

## 既知の制約

- DSH にはファイルのタブが開く前に割り込む仕組みがないため、Code ページに切り替わる前に、ファイルのタブが一瞬表示されます。
- binding の受け渡しは、code-server が `vscode.env.asExternalUri` に答えるときにページの URL の断片を保つことに依存しています。これは code-server の挙動であって、文書化された約束ではありません。code-server を更新したら確認し直してください。
