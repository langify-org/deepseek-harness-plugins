# DeepSeek Harness plugins by langify

[English](README.md) | 日本語 | [简体中文](README.zh.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用のプラグイン集です。npm パッケージ `@langify-org/dsh-*` として提供しています。

| プラグイン | できること |
|---|---|
| [`@langify-org/dsh-session-hooks`](plugins/session-hooks/README.ja.md) | セッションの開始時・アーカイブ時・アーカイブ解除時に、設定または信頼したプロジェクトの `.dsh/hooks.yml` に書いた shell コマンドを実行します。たとえば、セッションごとに専用の git worktree を用意できます。 |
| [`@langify-org/dsh-chrome`](plugins/dsh-chrome/README.ja.md) | 本物の Chrome を、DSH の右サイドバーであなたとエージェントが一緒に使えるようにします。専用のプロファイル（手元の Chrome のプロファイルのコピーも可）で動く専用の Chrome で、セッションごとにウィンドウを持ち、各セッションのサイドバーにそのウィンドウを表示します。Linux のみで、npm にはまだ公開していません。 |

どのプラグインも、通常の DSH の **bundle** です。`package.json` で `dsh.bundle`（プラグインを追加する patch）を宣言した npm パッケージです。session-hooks の patch はプラグインを自分自身からの相対パス（`./lib/index.js`）で指定しているので、DSH のどの読み込み方でも同じパッケージがそのまま動きます。dsh-chrome の patch はパッケージ名で指定しています。DSH はブラウザー側の部分を、プロファイルにインストールしたパッケージにしか配信しないためです。dsh-chrome は tarball からインストールしてください。

DSH 自体がまだリリース候補版のため、どのプラグインも試験的（0.x）です。各プラグインの README に、何に依存しているかを書いています。

## インストール

### npm（おすすめ）

```sh
dsh plugin --profile web add @langify-org/dsh-session-hooks
```

Web UI の **Plugins** ページから、パッケージ名を指定してインストールすることもできます。インストール後は、各プラグインの README に従って設定してください。dsh-chrome はまだ npm にないので、次の方法で tarball からインストールしてください。

### tarball またはチェックアウトから

```sh
dsh plugin --profile web add ./langify-org-dsh-session-hooks-0.1.0.tgz
dsh web --patch /path/to/plugins/session-hooks/cordis.patch.yml
```

1行目は、`pnpm pack` または後述の Nix ビルドで作った tarball をインストールします。`nix build .#dsh-chrome` を実行すると dsh-chrome の tarball が `result/` にできます。これは **Plugins** ページの **Add plugin** に渡してもかまいません。2行目はビルド済みのチェックアウトを、インストールせずにそのまま読み込みます。dsh-chrome はインストールしないと読み込めません。

### Nix

flake は各プラグインをソースからビルドしてテストを実行します。ビルド結果には、プラグインの npm tarball と、それを展開した同じパッケージが入っています。`lib.mkPlugins` は、`--patch` で読み込めるプラグイン（session-hooks）を利用中の DSH 本体のモジュールとつなぎます。dsh-chrome は、ビルド結果の tarball からインストールしてください。まず flake の inputs に追加します。このとき、自分の `nixpkgs` に follows させないでください。CI がテストしているのは flake 自身が固定している nixpkgs で、pnpm の版が変わると依存のハッシュが合わなくなることがあります。

```nix
inputs.dsh-plugins.url = "github:langify-org/deepseek-harness-plugins";
```

次に、`dsh` のコマンドラインを組み立てる場所で、プラグインの patch を渡します。

```nix
let
  dshPlugins = inputs.dsh-plugins.lib.mkPlugins {
    inherit pkgs;
    dshNodeModules = "${deepseekHarness}/lib/deepseek-harness/node_modules";
  };
  hookConfig = pkgs.writeText "session-hooks.patch.yml" (builtins.toJSON [
    { id = "langify-session-hooks"; config.sessionStart = [ "~/.config/dsh/hooks/start.sh" ]; }
  ]);
in
"dsh web --patch ${dshPlugins.session-hooks.patch} --patch ${hookConfig}"
```

`dshNodeModules` を渡さずに `mkPlugins { inherit pkgs; }` とすると、DSH とつなぐ前の素のビルドが得られます。これは `packages.<system>.<plugin>` と同じものです。

## 開発

必要なもの：Node.js 24、pnpm 12、`just e2e` と `just dev` 用に `dsh` 0.2。dsh-chrome には Google Chrome、TigerVNC の Xvnc、Openbox も必要です。`nix develop` で Node.js・pnpm・just・Xvnc・Openbox が使えるようになります。

```sh
pnpm install
pnpm check
pnpm dev
just e2e session-hooks
just dev-use-profile
just dev session-hooks
```

- `pnpm check`（`just check` でも同じ）：Biome を実行し、README の翻訳がそろっているかを確認してから、型チェック、単体テスト、ビルド、DSH 本体のパッケージを使ったプラグインのテストを実行します。本物の Chrome を使う dsh-chrome のテストは `pnpm test:integration` で実行します。
- `pnpm dev`：すべてのプラグインをビルドし、専用の開発用 DSH（`.dsh-home`）にインストールして、その Web UI を 3390 番ポートで起動します。変更したら、もう一度実行してください。この PC にインストールされている DSH Desktop の DSH を使います。
- `just e2e session-hooks`：使い捨ての DSH ホームで、本物の `dsh` を使ってプラグインを動かします。
- `just dev-use-profile`：最初に1回だけ実行します。`dev/local.patch.yml` から自分の DSH プロファイルの patch へリンクを張り（読み取りのみ）、開発用の UI がいつもと同じモデルに接続できるようにします。
- `just dev session-hooks`：このプラグインと例のフックを入れた開発用の DSH Web UI を 3091 番ポートで起動し、ブラウザで開きます。専用の DSH ホームと、セッション用の使い捨て git リポジトリを使うので、普段の DSH やこのリポジトリには影響しません。

プラグインの追加、テスト、リリース、DSH の版上げの規約は [AGENTS.md](AGENTS.md)（英語）に、DSH のプラグインを書いてわかったことは [docs/plugin-guidelines.md](docs/plugin-guidelines.md)（英語）にまとめています。人もコーディングエージェントも同じ規約に従います。リポジトリと各プラグインの README は、英語・日本語・簡体字中国語の3言語で管理しています。

## ライセンス

MIT
