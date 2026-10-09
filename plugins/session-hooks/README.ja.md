# @langify-org/dsh-session-hooks

[English](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/README.md) | 日本語 | [简体中文](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/README.zh.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）のセッションが開始したとき、アーカイブされたとき、アーカイブから戻されたときに、あなたの shell コマンドを実行します。主な使い道は、セッションごとに専用の git worktree を用意すること、リソースの準備や後片付け、外部のタスク管理ツールとの同期などです。

| イベント | 実行されるタイミング | コマンドでできること |
|---|---|---|
| `sessionStart` | 新しいセッションが作成されたとき（最初のモデルへのリクエストの前） | 準備作業。また `{"workdir": ..., "context": ...}` を出力すると、セッションの作業ディレクトリを指定し、それをモデルに伝えられます |
| `sessionArchive` | セッションがアーカイブされた後 | リソースの後片付けや退避 |
| `sessionUnarchive` | アーカイブされたセッションが戻された後 | リソースの復元 |

DSH `0.2.x` と POSIX シェル（Linux または macOS）が必要です。

## インストール

**npm から**（どの DSH 環境でも使えます）：

```sh
dsh plugin --profile web add @langify-org/dsh-session-hooks
```

Web UI の **Plugins** ページから、パッケージ名を指定してインストールすることもできます。インストール中に pnpm が `Issues with peer dependencies found` という警告を出しますが、問題ありません。`@deepseek-ai/*` の peer 依存は DSH 本体が提供します。

**`--patch` で読み込む**（プロファイルを変更しない方法。Nix 環境で使います）：bundle に同梱の patch ファイルを `dsh` に渡します。プラグインのパスはこのファイルからの相対パスなので、展開したパッケージでもチェックアウトでもそのまま動きます。

```sh
dsh web --patch /path/to/dsh-session-hooks/cordis.patch.yml --patch ./my-hooks.patch.yml
```

この方法で読み込む場合、プラグインは Node の通常の探索で DSH 本体の `@deepseek-ai/*` モジュールを見つけられる必要があります。このリポジトリの Nix flake（`lib.mkPlugins`）はこれを自動で行います。詳しくは[リポジトリの README](https://github.com/langify-org/deepseek-harness-plugins/blob/main/README.ja.md#nix) を参照してください。

インストールしただけでは何も実行されません。フックを設定して初めて動きます。

## 設定

プロファイルの patch レイヤー（`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）か、後から読み込む `--patch` ファイルに、次の行を追加します。この行はプラグインの `config` 全体を置き換えるので、使うキーはすべて書いてください。

```yaml
- id: langify-session-hooks
  config:
    sessionStart:
      - ~/.config/dsh/hooks/start.sh
    sessionArchive:
      - command: ~/.config/dsh/hooks/archive.sh
        timeoutMs: 120000
    sessionUnarchive:
      - ~/.config/dsh/hooks/unarchive.sh
```

既定の `web` プロファイルでは、プロファイルの `cordis.patch.yml` を保存すると変更がすぐに反映されます。HMR が無効なプロファイルや `--patch` のファイルを変更した場合は、DSH の再起動が必要です。

| キー | 既定値 | 意味 |
|---|---|---|
| `sessionStart`、`sessionArchive`、`sessionUnarchive` | `[]` | 各イベントで実行するコマンド。文字列か `{ command, timeoutMs }` で書きます。上から順に1つずつ実行します。 |
| `startSources` | `[startup]` | どの種類のセッション開始で `sessionStart` を実行するか：`startup`（新規セッション）、`resume`、`clear`、`compact`。 |
| `includeSubagents` | `false` | サブエージェントやチームメイトのセッションでもフックを実行します。 |
| `defaultTimeoutMs` | `60000` | `timeoutMs` を指定しないコマンドのタイムアウト（ミリ秒）。 |
| `shell` | `bash` | コマンドは `<shell> -c <command>` として実行されます。 |
| `stateDir` | `$DSH_HOME/langify-session-hooks` | セッションごとの記録と `hooks.log` の保存先。 |

## コマンドが受け取る情報

各コマンドはセッションのディレクトリで実行されます（そのディレクトリがもう存在しない場合は DSH 自身のディレクトリ）。stdin には1行の JSON が渡されます。

```json
{"hook_event_name":"SessionStart","session_id":"session-…","cwd":"/home/me/project","workdir":null,"source":"startup"}
```

| フィールド | 意味 |
|---|---|
| `hook_event_name` | `SessionStart`、`SessionArchive`、`SessionUnarchive` のいずれか |
| `session_id` | DSH のセッション ID |
| `cwd` | セッションが作成されたディレクトリ |
| `workdir` | 開始時のコマンドが指定したディレクトリ（後述）。なければ `null`。アーカイブ時・解除時のコマンドには、開始時に記録した値が渡されます（DSH を再起動した後でも同じです）。 |
| `source` | `SessionStart` のみ：`startup`、`resume`、`clear`、`compact` のいずれか |
| `parent_session_id`、`origin` | フォークしたセッションと、サブエージェント（`origin: "subagent"`）の場合に付きます |

同じ情報は環境変数 `DSH_HOOK_EVENT`、`DSH_SESSION_ID`、`DSH_SESSION_CWD`、`DSH_SESSION_WORKDIR`、`DSH_HOOK_SOURCE` にも入ります。DSH 自身の環境変数も引き継がれます。フィールド名は、意味が同じものは Claude Code のフックの payload に合わせています。

## セッションに別のディレクトリで作業させる

DSH はセッションのディレクトリを作成時に固定するため、フックから変更することはできません。代わりに、`sessionStart` のコマンドが JSON オブジェクトを出力できます。出力全体でも、最後の1行でもかまいません。

```json
{"workdir": "/home/me/.local/share/dsh-worktrees/project/session-…", "context": "Branch dsh/session-… was created for you."}
```

- `workdir` は存在するディレクトリでなければなりません。プラグインはモデルに、そこで作業する（コマンドをそのディレクトリで実行し、その下のファイルを編集する）よう伝えます。また、後続の開始時コマンドと、そのセッションのアーカイブ時・解除時のコマンドに渡します。
- `context` はモデルに伝える追加のテキストです。

これらは、セッションの最初のモデルへのリクエストの前に、1つのメモとして追加されます。Web UI のファイルパネルと、サイドバー上でのセッションの所属は、元のディレクトリのままです。

## 例：セッションごとに git worktree を用意する

[`examples/`](https://github.com/langify-org/deepseek-harness-plugins/tree/main/plugins/session-hooks/examples) には、組み合わせて使う3つのスクリプトがあります。

- [`worktree-start.sh`](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/examples/worktree-start.sh)：git リポジトリ内でセッションが開かれたとき、新しいブランチ `dsh/<セッション ID>` の worktree を作り、それを `workdir` として出力します。
- [`worktree-archive.sh`](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/examples/worktree-archive.sh)：アーカイブ時に、未コミットの変更がなければその worktree を削除します。ブランチは残します。
- [`worktree-unarchive.sh`](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/examples/worktree-unarchive.sh)：アーカイブ解除時に、ブランチから worktree を作り直します。

```yaml
- id: langify-session-hooks
  config:
    sessionStart:
      - bash /path/to/dsh-session-hooks/examples/worktree-start.sh
    sessionArchive:
      - bash /path/to/dsh-session-hooks/examples/worktree-archive.sh
    sessionUnarchive:
      - bash /path/to/dsh-session-hooks/examples/worktree-unarchive.sh
```

`dsh plugin add` でインストールした場合、スクリプトは `$DSH_HOME/profiles/<profile>/node_modules/@langify-org/dsh-session-hooks/examples/` にあります。パッケージマネージャーは実行権限を保持しないので、上の例のように `bash` で実行するか、自分の場所にコピーして書き換えて使ってください。worktree は `$DSH_WORKTREES_DIR`（既定は `~/.local/share/dsh-worktrees`）に作られます。リポジトリの E2E テストは、これらのスクリプトをそのまま本物の DSH で実行しています。

## 失敗とログ

- 0 以外で終了したコマンド、タイムアウトしたコマンド、起動できなかったコマンドは報告されますが、DSH はそのまま動き続けます。失敗した開始時コマンドの `workdir` と `context` は使われず、次のコマンドは通常どおり実行されます。
- すべての実行結果は `<stateDir>/hooks.log` に JSON Lines で追記されます（イベント、セッション、結果、終了コード、所要時間、stdout と stderr の末尾）。失敗は DSH の stderr にも `[langify-session-hooks] …` として出力されるので、ターミナルやサービスのログで確認できます。
- `sessionStart` のコマンドが終わるまで、セッションの作成は待たされます。コマンドは短時間で終わるようにし、時間のかかるものには `timeoutMs` を設定してください。
- DSH の停止時やプラグインの再読み込み時には、実行中のコマンドを止めます（SIGTERM を送り、3秒後に SIGKILL）。アーカイブ用のスクリプトは、もう一度実行されても問題ないように書いてください。
- コマンドの終了後も動き続けるバックグラウンドプロセスは、待つことも止めることもしません。`nohup task >/dev/null 2>&1 &` のように出力をリダイレクトしてください。

## セキュリティ

コマンドは DSH プロセスと同じ権限で、エージェントのサンドボックスの外で実行されます（Claude Code のフックと同様です）。コマンドはあなたの patch レイヤーからしか読み込みません。プロジェクトのディレクトリからフックの設定を読むことはないので、clone したリポジトリでセッションを開いても、そのリポジトリのコードが実行されることはありません。

## 仕組み

- **開始：** DSH はセッションを作成すると `agent/created` を発行します。プラグインはこのリスナーの中でコマンドの完了を待つので、コマンドは最初のリクエストより前に終わります。その後、`agent.inject()` で `notice` 形式のメモを追加します。
- **アーカイブと解除：** DSH にはアーカイブのイベントがありません。ワークスペースレジストリはアーカイブ済みセッションの一覧をストレージに保存し、書き込みのたびに新しい一覧付きで `domain/changed` を発行します。プラグインは前回の一覧との差分を取ります。プラグインの起動前にアーカイブされたセッションでは、フックは実行されません。
- 同じセッションのフックは順番に、別のセッションのフックは並行して実行されます。

## ライセンス

MIT
