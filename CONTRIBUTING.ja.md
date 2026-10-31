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

1. `packages/greet` を `packages/<name>` にコピーし、パッケージ名を `@langify-org/dsh-<name>` に変え、`"private": true` を削除して `"publishConfig": { "access": "public" }` を追加する。`repository.directory`・`homepage`・`description` も更新する。
2. `cordis.patch.yml` のプラグイン行の id に `langify-` を前置し、他のバンドルの行と衝突しないようにする。
3. Host と共有する DSH パッケージは `peerDependencies`（範囲指定）と `devDependencies`（`catalog:`）の両方に書く。新しい DSH パッケージは `pnpm-workspace.yaml` の catalog に追加する。
4. `engines.dsh` は、そのプラグインを検証している範囲と一致させる。
5. README を英語・日本語・中国語で書き、ルートの README の表にプラグインを追加する。
6. ブラウザー側を持つ場合は、[`tsdown.client.ts`](tsdown.client.ts) の `clientBundle()` で `src/client/index.tsx` をビルドし、`dsh.client` を宣言して `./client` を `./dist/client.cjs` として export する。型検査は `src/client/tsconfig.json` を `typecheck` スクリプトから実行する。例は [`packages/code-server`](packages/code-server)。

`pnpm dev` と `pnpm smoke` は `dsh.bundle` を宣言したパッケージをすべて対象にします。

## リリース

1. 公開しているパッケージを変えるプルリクエストには changeset を付けます。`pnpm changeset` を実行してパッケージと変更の種類を選び、書き出されたファイルをコミットします。
2. `main` では Release workflow が **Version Packages** のプルリクエストを最新に保ちます。版を上げ、各パッケージの `CHANGELOG.md` を書きます。これをマージすると、CI から npm に新しい版が公開されます（provenance 付き、トークンの保存は不要）。
3. 新しいパッケージの最初の版はメンテナーが公開します。npm は、パッケージが存在してからでないと CI を信頼できないためです。`pnpm build` の後、パッケージのディレクトリで `pnpm publish` を実行します。続けて npmjs.com で、このリポジトリの `release.yml` をそのパッケージの trusted publisher に追加します。

## 規約

- **型**: 共通の `tsconfig.base.json` は `exactOptionalPropertyTypes`・`noUncheckedIndexedAccess`・`isolatedDeclarations` を含む厳格設定です。export する値には明示的な型が必要です。これにより tsdown は TypeScript の API ではなく oxc で型定義を生成できます（TypeScript 7 はその API を持ちません）。Host とブラウザーのコードは別のプログラム（ルートの `tsconfig.json` と各パッケージの `src/client/tsconfig.json`）として型検査します。DSH が同じ Cordis の `Context` に、Host 側とブラウザー側で別のサービスを宣言しているためです。
- **テストより先に型**: コンパイラーが検査できることは型で表します。契約は interface、取りうる値の集合は union、全要素を網羅すべき対応表は `Record<Union, …>`（code-server の翻訳はこの形ですべてのエラーコードを網羅しています）、信頼境界ではその interface を注釈した実行時の検証で表します。テストは型で表せないこと、つまり時間・入出力・信頼できない入力の解析・セキュリティ上の検査・プロトコルの境界ケースだけに書きます。コンパイラーがすでに保証していることや、一行の配線はテストしません。テストは、その名前が示す振る舞いが壊れたら失敗しなければなりません。
- **結合**: `pnpm smoke` は DSH が各バンドルを合成できるかを検査します。ブラウザーや他のプログラムが必要な確認は、各パッケージの README に手順を書きます。
- **Lint**: lint エラーをコード内で抑制しません。ある種類のファイル全体でルールが合わない場合は `.oxlintrc.json` を変更し、そこにコメントで理由を書き、プルリクエストでも説明します。
- **パッケージ**: ESM のみ。公開パッケージにはビルド済みファイルだけを含め、インストール時スクリプトを実行しません。
- **DSH の版**: `pnpm-workspace.yaml` の catalog が開発と CI で使う DSH の版を固定します。これは `engines.dsh` の下限です。DSH を更新するときは catalog を変え、続けて各 `engines.dsh` と peer の範囲を変えます。
- **文書**: 英語版が正本です。英語の文書を変更したら、同じプルリクエストで `.ja.md` と `.zh.md` の訳も更新します。
