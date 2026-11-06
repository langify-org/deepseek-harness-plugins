# @langify-org/dsh-tmux

[English](README.md) | 日本語 | [中文](README.zh.md)

自分とモデルが共有する、会話ごとのターミナルを tmux で用意します。会話ごとに tmux session が 1 つでき、DeepSeek Harness の右サイドバーの **tmux** タブに表示されます。session は、ページの再読み込み・タブを閉じる・DSH の再起動を越えて残ります。モデルはターンの最初にどんな window があるかを知り、tmux のどんなコマンドも実行できるツールで作業します。

## 必要なもの

- Web UI のある DSH `>=0.2.1-rc.5 <0.3.0-0`。
- DSH の host にある [`tmux`](https://github.com/tmux/tmux)。`PATH` にあるか、設定の `tmux` で場所を指定します。ないときは、タブにそう表示します。Windows の host では tmux が動きません。
- なくてもよいもの：ユーザーの systemd（`systemd-run --user`）。あると tmux の server が専用の scope で動き、DSH を再起動しても window が残ります。ないと、server は DSH と一緒に止まります。

## 導入

```sh
dsh plugin --profile <profile> add @langify-org/dsh-tmux
```

DSH の Web 版や Desktop 版では **Plugins** ページから追加できます。

## 設定

| 設定     | 既定値                                   | 何か                                           |
| -------- | ---------------------------------------- | ---------------------------------------------- |
| `tmux`   | `tmux`                                   | tmux の実行ファイル。`PATH` で探す名前か、パス |
| `socket` | `<DSH home>/tmux/socket`（bundle layer） | tmux の server の socket                       |

## 使い方

右サイドバーから **tmux** を開くと、その会話の tmux session が出ます。

- **自分の tmux の設定がそのまま使われます。** 使っている tmux が探す場所（既定では `/etc/tmux.conf`・`~/.tmux.conf`・`~/.config/tmux/tmux.conf`）のどれにあっても読み込まれます。プラグインが変えるのは、session がなくても tmux の server を止めないことだけです。
- **tmux の設定がないときは**、プラグインの既定が使われます。ステータス行が上に出て window がタブとして並び、マウスが使えます（window をクリックすると切り替わり、ホイールでスクロールできます）。自分の設定でも同じにしたいときは、`set -g mouse on` を足してください。
- **右クリック**はブラウザのメニューを出さずに tmux に渡します。ボタンを押したまま tmux のメニューの項目まで動かして離すと、その項目を選べます。Shift を押しながら右クリックするか長押しすると、ブラウザのメニューが出ます。
- **コピー**：マウスで選ぶか、tmux のコピーモードでコピーすると、手元の端末のクリップボードに入ります（tmux が OSC 52 で送ってきます）。ブラウザが書き込みを断ったときは、タブに **コピー** のボタンが出ます。Shift を押しながらドラッグすると、ブラウザの選択になり、Ctrl+C（Cmd+C）でコピーできます。
- **リンク**：プログラムがリンクとして出した文字（OSC 8。`ls --hyperlink` など）は、Ctrl か Cmd を押しながらクリックすると開きます。
- **見た目**は DSH に合わせます。ライト・ダークの背景と文字の色、ターミナルのフォントと大きさの設定に従います。
- **スマホでは**、window をタップすると切り替わり、スワイプで tmux の履歴を遡れます（tmux のコピーモード。`q` で抜けます）。
- **タブを複数開くと**、1 台でも複数の端末でも、それぞれ同じ session の別の window を表示できます。タブを閉じても接続が切れても、session と中のプログラムは動き続け、つなぎ直すとタブは attach し直します。
- **会話を archive すると**、その tmux session は終わります。プログラムが動いているときは、archive のダイアログが止める作業として表示します。
- **自分の端末からも**、`tmux -S <DSH home>/tmux/socket attach -t '=dsh-<session id>'` で同じ session に入れます。DSH 内蔵のターミナルのタブは、普通の shell のままです。

モデルが terminal について知るのは次のとおりです。

- **system prompt**：どの会話でも、共有の terminal・ツール・下の通知の形を説明しています。
- **ターンの最初**：前回から window が変わっていれば、`<tmux>` の通知を受け取ります。window ごとに `<window id="@3" name="bash" path="~/repo" command="bash"/>` が 1 つ入ります。中身が空の `<tmux>` は session が閉じたことを表します。session のない会話には通知を送りません。
- **画面の中身**：モデルが自分で window を読んだときだけです。

モデルには、tmux のどんなコマンドも実行できるツールが 2 つあります。socket と向ける先はプラグインが埋めます。

| ツール         | 引数                                           | 向く先                                                           |
| -------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `tmux_window`  | window id（必須）・pane の番号・コマンド・引数 | その window か pane。会話の session のものかを確かめてから向ける |
| `tmux_session` | コマンド・引数                                 | 会話の session                                                   |

- window は id で指します。id は tmux の server が動いている間、変わらず使い回されもしないからです。番号と名前は変わることがあります。
- たとえば、`tmux_window` に `capture-pane -p` で window を読み、`send-keys` で打ちます。`tmux_session` に `new-window -d` で window を開くと、その id が返ります。session がなければ作ります。
- 新しい window と pane は会話のフォルダで始まります。
- モデルは自分で `-t` を書けず、`list-windows` と `list-panes` に `-a` も渡せないので、会話の外には届きません。
- subagent が呼ぶと、その会話の session に向きます。

## 安全性

- **tmux は sandbox の外で動きます。** そのため、何かを変える tmux のコマンドは、sandbox の外でのコマンドと同じ許可を求めます。会話がフルアクセスならすぐ実行し、それ以外は tmux のコマンドを示して先に確認します。確認を出せない subagent は、フルアクセスのときだけ実行できます。
- **読むだけなら確認なし**：`capture-pane -p`・`list-windows`・`list-panes`・`show-options` は確認なしで動きます。ただし、引数に `#(`（shell のコマンドを実行する書式）や、`;` で終わるもの（別の tmux のコマンドを始める）があるときは確認します。
- **session の中身はすべてモデルから見えます。** モデルに読まれて困る秘密は、その会話の terminal には表示しないでください。
- **タブの接続**は、DSH 自身の API と同じように確かめます。この DSH にログインしたブラウザだけがターミナルを開けます。
- **環境変数**：tmux とその shell には、DSH 自身の terminal と同じく、名前に `KEY`・`PASSWORD`・`SECRET`・`TOKEN` を含む変数と `DSH_*` を抜いた DSH の環境を渡します。
- **分離**：tmux の server は DSH home ごとに 1 つ（`<DSH home>/tmux/socket`）なので、自分の tmux の session には触れません。各会話に伝えるのは、その会話の session だけです。subagent には伝えません。

## 仕組み

- **ブラウザ側**：**tmux** タブを足し、tmux が OSC 52 で送ってきたコピーをクリップボードに入れます。ターミナルは版を固定して同梱した [wterm](https://github.com/vercel-labs/wterm) で描き、専用の WebSocket（`/langify-tmux`）で host とつなぎます。
- **host 側のターミナル**：接続ごとに、DSH の API と同じように確かめてから、必要なら会話の tmux session（`dsh-<session id>`）を作り、DSH のターミナルの subprocess provider で `tmux new-session -t '=dsh-<session id>'` を動かします。接続と一緒に消える専用の view なので、タブごとに別の window を表示できます。
- **host 側のそのほか**：
  - system prompt に説明を足し、2 つのツールを登録します。
  - server がなければ、`exit-empty off` で起動します（できれば専用の systemd の scope で）。タブのターミナルの種類に `hyperlinks` の機能を足し、tmux がリンクを通すようにします。
  - server に、探す設定ファイルの一覧（`#{config_files}`）を聞き、どれも存在しないときだけ、既定を server に設定します。
  - `agent/pre-step` で、ターンの最初の step に window の一覧を足します。モデルが最後に見た一覧は session projection が覚えていて、compaction のあとは覚えた内容を消して渡し直します。
  - 動いているプログラムを archive のダイアログに伝え、archive されたら session を終わらせます。
  - 起動時には、その間に archive・削除された会話の session を終わらせます。

## 既知の制約

- **server は動き続けます**：プラグインを外しても止まりません。`tmux -S <DSH home>/tmux/socket kill-server` で止めます。
- **ライトのときに薄い色がある**：ターミナルの 16 色は DSH 内蔵のターミナルと同じ xterm の配色で、ライトの背景では黄色や白が薄く見えます。
- **スマホに Ctrl・Esc・Tab・矢印のキーがありません**：スマホのキーボードにはなく、タブも足していません。

## ブラウザーでの確認

tmux を `PATH` に入れて、リポジトリの直下で `pnpm dev` を実行します。

1. 会話で右サイドバーから **tmux** を開く。ステータス行に window `0` が出る。
2. ターミナルの上で右ボタンを押したまま、tmux のメニューの **Horizontal Split** まで動かして離す。window が分かれ、ブラウザのメニューは出ない。
3. モデルに、window を開いて `echo hello` を実行し、読み返すよう頼む。`tmux_session` で window を開き（フルアクセスでなければ先に確認が出る）、`tmux_window` でコマンドを打ち、確認なしで読み返して `hello` と報告する。
4. モデルに window の一覧を聞く。2 つの window をフォルダと一緒に答える。
5. ターミナルの文字をドラッグして選ぶ。ボタンを離すと、手元のクリップボードに入っている。
6. ページを再読み込みする。タブが attach し直し、同じ window が出る。
7. window で `sleep 600` を動かしたまま会話を archive する。ダイアログに tmux の作業が 1 件出て、止めると tmux session が終わる。
