# 貢献ガイド

[English](CONTRIBUTING.md) | 日本語 | [中文](CONTRIBUTING.zh.md)

## 環境構築

[Nix](https://nixos.org) と [direnv](https://direnv.net) がある場合:

```sh
direnv allow
pnpm install
```

Nix を使わない場合は、[`.node-version`](.node-version) に書かれた版の Node.js 公式ビルドと、pnpm 11（`package.json` の `packageManager` の版）を入れてください。nixpkgs の `nodejs` のようにソースからビルドした Node では DSH が起動できません。そのため dev shell は公式バイナリを使います。

## コマンド

| コマンド          | 内容                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| `pnpm check`      | CI と同じ検査を順に全部実行する。プルリクエストを出す前に実行する。             |
| `pnpm dev`        | 全プラグインをリンクした DSH Web を起動し、変更時にプラグインを再読み込みする。 |
| `pnpm format`     | oxfmt でファイルを整形する。                                                    |
| `pnpm lint`       | oxlint で型情報を使った lint をする。                                           |
| `pnpm typecheck`  | TypeScript 7（tsgo）で型検査する。                                              |
| `pnpm test`       | Vitest でユニットテストを実行する。                                             |
| `pnpm build`      | tsdown で全パッケージをビルドする。                                             |
| `pnpm publint`    | 各パッケージの公開形式を検査する。                                              |
| `pnpm docs:check` | すべての文書に日本語訳と中国語訳があるか検査する。                              |
| `pnpm smoke`      | 使い捨ての DSH ホームに全プラグインを入れ、バンドル層が合成されるか検査する。   |

pre-commit フック（lefthook）が staged ファイルを整形・lint します。

## 開発の流れ

`pnpm dev` は DSH の状態を `.dsh/` に置き、普段使いの DSH とは分けます。パッケージをビルドし、そこの `web` プロファイルにリンクし、`tsdown --watch` と DSH Web を起動します。ソースを保存するとパッケージが再ビルドされ、DSH の HMR が再起動なしで動作中のプラグインを差し替えます。`pnpm dev` の後ろの引数は `dsh web` に渡ります（例: `pnpm dev --port 3081`）。

モデルには API キーが必要です。git の管理外で direnv が読み込む `.envrc.local` に書いてください。

```sh
export DEEPSEEK_API_KEY=...
```

他のプロバイダーは設定ページで設定できます。その設定も `.dsh/` に保存されます。`.dsh/` を削除すると最初からやり直せます。

## プラグインの追加

1. `packages/greet` を `packages/<name>` にコピーし、パッケージ名を `@langify-org/dsh-<name>` に変え、`"private": true` を削除する。`repository.directory`・`homepage`・`description` も更新する。
2. `cordis.patch.yml` のプラグイン行の id に `langify-` を前置し、他のバンドルの行と衝突しないようにする。
3. Host と共有する DSH パッケージは `peerDependencies`（範囲指定）と `devDependencies`（`catalog:`）の両方に書く。新しい DSH パッケージは `pnpm-workspace.yaml` の catalog に追加する。
4. `engines.dsh` は、そのプラグインを検証している範囲と一致させる。
5. README を英語・日本語・中国語で書き、ルートの README の表にプラグインを追加する。

`pnpm dev` と `pnpm smoke` は `dsh.bundle` を宣言したパッケージをすべて対象にします。

## 規約

- **型**: 共通の `tsconfig.base.json` は `exactOptionalPropertyTypes`・`noUncheckedIndexedAccess`・`isolatedDeclarations` を含む厳格設定です。export する値には明示的な型が必要です。これにより tsdown は TypeScript の API ではなく oxc で型定義を生成できます（TypeScript 7 はその API を持ちません）。
- **Lint**: lint エラーをコード内で抑制しません。ある種類のファイル全体でルールが合わない場合は `.oxlintrc.json` を変更し、理由をプルリクエストに書きます。
- **テスト**: プラグインのロジックは DSH を起動せずに直接テストします。DSH との結合は `pnpm smoke` が受け持ちます。
- **パッケージ**: ESM のみ。公開パッケージにはビルド済みファイルだけを含め、インストール時スクリプトを実行しません。
- **DSH の版**: `pnpm-workspace.yaml` の catalog が開発と CI で使う DSH の版を固定します。これは `engines.dsh` の下限です。DSH を更新するときは catalog を変え、続けて各 `engines.dsh` と peer の範囲を変えます。
- **文書**: 英語版が正本です。英語の文書を変更したら、同じプルリクエストで `.ja.md` と `.zh.md` の訳も更新します。
