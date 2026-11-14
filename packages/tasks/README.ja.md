# @langify-org/dsh-tasks

[English](README.md) | 日本語 | [中文](README.zh.md)

DeepSeek Harness の右サイドバーの **タスク** タブから、[justfile](https://just.systems) の recipe を実行します。recipe ごとに実行ボタンがあり、コマンドは DSH 自身の terminal の新しいタブで動きます。

## 必要なもの

- Web UI のある DSH `>=0.2.2-rc.2 <0.3.0-0`。
- ホストの `PATH` にある [`just`](https://just.systems)。引数の説明・オプション・フラグは `[arg(...)]` 属性から読みます。この属性は最近の `just` にあり、古い版ではこれらなしで recipe を一覧にします。

## 導入

```sh
dsh plugin --profile <profile> add @langify-org/dsh-tasks
```

DSH の Web 版や Desktop 版では **Plugins** ページから追加できます。

## 設定

| 設定    | 既定値     | 何か                                                                                                                                              |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runIn` | `terminal` | recipe を動かす場所。`terminal` は terminal の新しいタブ、`tmux` は会話の tmux session の新しい window（[@langify-org/dsh-tmux](../tmux) が必要） |

## 使い方

右サイドバーのガイドから **タスク** を開きます。セッションの作業フォルダから `just` が見つけた justfile（上のフォルダにあるものも含む）の公開 recipe を、doc コメントと、`just` の書き方での引数（`target mode=debug [--verbose] *rest`）と一緒に一覧にします。

- recipe を押すと実行します。terminal の新しいタブが開き、`just <recipe>` が打ち込まれます。止めるときはその terminal で Ctrl-C を押します。
- **tmux で動かす**：設定が `runIn: tmux` で、tmux プラグインが動いているときは、代わりに会話の tmux session の新しい window で動かし、**tmux** タブがその window を表示して開きます。tmux プラグインがないときは、terminal のタブで動かします。
- 引数のある recipe は、押すと先に行の下に引数の欄が開きます。文字列の初期値は最初から入っていて、フラグはチェックボックス、可変長の引数（`*rest`、`+rest`）はスペース区切りで入れます。引数の説明はマウスを乗せると出ます。Enter で実行、Esc で閉じます。値のチェック（`pattern` を含む）は `just` がします。
- 一覧は、ウィンドウに戻ってくるたびに justfile を読み直します。justfile がセッションのフォルダより上にあるときは、一覧の下にその場所を出します。

`_` で始まる recipe、`[private]` の recipe、`mod` で読み込んだ recipe は一覧に出ません。terminal のタブで実行したことはモデルに伝えず、その出力もモデルの履歴に入りません。tmux で動かしたものは、ほかの tmux の window と同じで、モデルは次のターンの最初にそれを知り、読むこともできます。

## 安全性

実行ボタンを押すのは、`just <recipe>` を自分で打つのと同じです。ユーザーの権限で、エージェントのサンドボックスの外で動き、実行するコマンドは terminal に表示されます。一覧を取るだけでは justfile のコードは動きません。入力欄の値は対話シェルに打ち込むので、どの値もシングルクォートで囲みます。制御文字の入った値は、クォートの中でも terminal が反応するので受け付けません。

## 仕組み

ホスト側のプラグインが、セッションの作業フォルダで `just --dump --dump-format json` を実行して recipe を返します。`runIn: tmux` のときは、ホスト側が実行時に `ctx.get` で tmux プラグインの `langifyTmux` サービスを探してコマンドを渡し（どちらのパッケージも相手を import しません）、ブラウザー側はサービスが返した種類のタブを開きます。そうでないときは、ブラウザー側が右サイドバーの `openTab('terminal')` で terminal のタブを開き、そのタブの terminal を `ctx.webTerminals` から取り出します。つながって書き込めるようになるのを待ってから、コマンドと Enter を書き込みます。

## 既知の制約

- **terminal の使い方が非公開の API に頼っている**：`ctx.webTerminals` は terminal のタブ自身が使うサービスで、プラグイン向けの API として説明されていません。DSH を更新すると、実行が動かなくなることがあります。
- **入力欄はテキストだけ**：`debug|release` のような `pattern` を、まだ選択肢として出しません。

## ブラウザーでの確認

リポジトリの直下で `pnpm dev` を実行し、justfile のあるフォルダのセッションで次を確かめます。

1. 右サイドバーのガイドから **タスク** を開く。recipe が引数と一緒に出る。
2. 引数のない recipe を押す。terminal のタブが開き、`just <recipe>` が動く。
3. 引数のある recipe で、入力欄に `a b; echo hi` のような値を入れて実行する。recipe には値がそのまま届き、`echo hi` は動かない。
4. 時間のかかる recipe を実行し、terminal で Ctrl-C を押して止める。
