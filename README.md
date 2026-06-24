# ClientFixTrace

JavaScriptライブラリの更新に伴う破壊的変更（Breaking Changes）の影響を、  
クライアントコードのAST解析と修正コミット追跡を通じて特定・追跡するパイプライン。

---

## ⚠️ データ配置とリポジトリ構成について

本リポジトリは現在、**親ディレクトリ（メタリポ `BCPatternGen`）配下の共有ディレクトリ** を入出力先として参照する構成です。

- 入力データ: `BCPatternGen/datasets/`, `BCPatternGen/clonedata/clientRepos/`
- R-BC 解析結果: `BCPatternGen/outputs/latest/R-BC/`
- 出力データ: `BCPatternGen/outputs/latest/ClientFixTrace/`

このため、**現在この ClientFixTrace を単体クローンしての実行はサポートされていません**（実行すると 1 つ上の階層にディレクトリを作成して動こうとし、ユーザの作業環境に影響を与える可能性があります）。

### 単体実行を行いたい場合

メタリポ統合前の安定版コミットをご利用ください:

```bash
git checkout d5c9ff4031e62b947d32d0caa18b260c8d422716
```

このコミット時点では、ClientFixTrace ディレクトリ内に閉じて動作します。

### 今後の予定

単体実行への対応（環境変数または fallback パスでの切り替え）を予定しています。

---

## セットアップ

```sh
npm install
```

### R-BC への依存について

本ツールは R-BC のコア（`detectByPattern` 等）を **ソース参照** で利用します。
メタリポ配下では兄弟ディレクトリ `../../R-BC`（メタリポが submodule として版を固定）を直接参照するため、追加設定は不要です（`make install-all` で R-BC の依存もインストールされます）。

単体実行で R-BC を別途用意する場合の安定版コミット(202604):
```
7111254b5c3b9ca83f6b874e265489968369d9a9
```


---

## 実行方法

プロジェクトルートの `Makefile` から実行する。  
入出力パスやデバッグ設定は各スクリプト冒頭の `CONFIG` セクションで変更する。

### Phase 1 — verHist（履歴抽出）

| コマンド | 内容 |
|---|---|
| `make verhist-full` | `test_result.json` から全ライブラリ×バージョンペアを自動抽出して処理 |
| `make verhist-partial` | `datasets/targets.json` に指定したペアのみ処理 |
| `make verhist-rbc` | **R-BC の検出クライアント起点**で処理（`test_result.json` 以外のデータ・部分集合向け） |

```sh

以下のいずれかを実行
make verhist-full
make verhist-partial
make verhist-rbc RBC_MODE=2   # RBC_MODE=0 method / 1 type-method / 2 type-method-object（既定 2）
```

> `verhist-rbc` は `verHistFromRBC.ts` を実行する。`outputs/latest/R-BC/<mode>/<lib>_<cleanVer>/detectByPattern/{failure,success}_detect.json` の `detectedClients` を success/failure メンバーシップに使い、ドット付きの版は `datasets/targets.json` から読む。ライブラリ単位で全クライアントを union してから 1 回だけ抽出するため、同一クライアントを複数バージョンで重複調査しない（`verhist-full` と同じ仕組み）。先に R-BC を実行（例: `make rbc-obj`）しておくこと。

---

### Phase 2 — detect（パターン検出）

| コマンド | 内容 |
|---|---|
| `make detect-full` | verHist-full の出力を対象に全件検出（success/failure 両ステート） |
| `make detect-partial` | `datasets/targets.json` に指定したタスクのみ検出（単一ステート） |

```sh
make detect-full       # 設定: src/detect.ts CONFIG.FULL
make detect-partial    # 設定: src/detect.ts CONFIG.PARTIAL
```

## R-BC との関係

本パイプラインは R-BC の出力（パターンファイル・検出結果）を入力として利用するが、  
**解析対象のデータソースは別物である**点に注意。  

### パターンファイルの種別

| ファイル名 | modeFlag | 内容 |
|---|---|---|
| `failure_detectpatternlist.json` | `0` | 型情報を除去した広域マッチ用パターン |
| `failure_patternList.json` | `1` | 型情報を含む厳密パターン |

どちらのファイルが使われるかはコードが自動判定する（`detectpatternlist.json` を優先）。
