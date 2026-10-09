# DeepSeek Harness plugins by langify

[English](README.md) | 日本語 | [简体中文](README.zh.md)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用のプラグイン集です。npm の `@langify-org/dsh-*` として公開しています。

| プラグイン | できること |
|---|---|
| [`@langify-org/dsh-session-hooks`](plugins/session-hooks/README.ja.md) | セッションの開始時・アーカイブ時・アーカイブ解除時に、指定した shell コマンドを実行します。たとえば、セッションごとに専用の git worktree を用意できます。 |

どのプラグインも、通常の DSH の **bundle** です。`package.json` で `dsh.bundle` を宣言した npm パッケージで、同梱の `cordis.patch.yml` がプラグインを追加します。patch はプラグインを自分自身からの相対パス（`./lib/index.js`）で指定しているので、DSH のどの読み込み方でも同じパッケージがそのまま動きます。

DSH 自体がまだリリース候補版のため、どのプラグインも試験的（0.x）です。各プラグインの README の「ステータス」に、何に依存しているかを書いています。

## インストール

### npm（おすすめ）

```sh
dsh plugin --profile web add @langify-org/dsh-session-hooks
```

Web UI の **Plugins** ページから、パッケージ名を指定してインストールすることもできます。インストール後は、各プラグインの README に従って設定してください。

### tarball またはチェックアウトから

```sh
dsh plugin --profile web add ./langify-org-dsh-session-hooks-0.1.0.tgz
dsh web --patch /path/to/plugins/session-hooks/cordis.patch.yml
```

1行目は `pnpm pack` で作った tarball をインストールします。2行目はビルド済みのチェックアウトを、インストールせずにそのまま読み込みます。

### Nix

flake は各プラグインをソースからビルドしてテストを実行し、利用中の DSH 本体のモジュールとつなぎます。まず flake の inputs に追加します。このとき、自分の `nixpkgs` に follows させないでください。CI がテストしているのは flake 自身が固定している nixpkgs で、pnpm の版が変わると依存のハッシュが合わなくなることがあります。

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

必要なもの：Node.js 24、pnpm 11、`dsh` 0.2。`nix develop` で Node.js・pnpm・just が使えるようになります。

```sh
pnpm install
just check
just e2e session-hooks
just dev session-hooks
```

- `just check`：README の翻訳がそろっているかを確認してから、型チェック、単体テストと結合テスト、ビルドを実行します。
- `just e2e session-hooks`：使い捨ての DSH ホームで、本物の `dsh` を使ってプラグインを動かします。
- `just dev session-hooks`：このプラグインを入れた開発用の DSH Web UI を、3091 番ポートで起動します。

プラグインの追加、テスト、リリース、DSH の版上げの規約は [AGENTS.md](AGENTS.md)（英語）にまとめています。人もコーディングエージェントも同じ規約に従います。README はすべて英語・日本語・簡体字中国語の3言語で管理しています。

## ライセンス

MIT
