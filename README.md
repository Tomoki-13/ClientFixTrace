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
make verhist-rbc RBC_MODE=2   # 0 method / 1 type-method / 2 type-method-object / 1.5,2.5 各 no_unknown 版（既定 2）
```

> `verhist-rbc` は `verHistFromRBC.ts` を実行する。`outputs/latest/R-BC/<mode>/<lib>_<cleanVer>/detectByPattern/{failure,success}_detect.json` の `detectedClients` を success/failure 別に使い、ドット付きの版は `datasets/targets.json` から読む。ライブラリ単位で全クライアントを統合してから 1 回だけ抽出するため、同一クライアントを複数バージョンで重複調査しない（`verhist-full` と同じ仕組み）。先に R-BC を実行（例: `make rbc-obj`）しておくこと。

#### 出力レイアウト

全 verHist（full / partial / rbc-*）は共通レイアウト（`src/utils/verHistLayout.ts`）で出力する。
**mode をトップに置く**（R-BC と統一）ことで開かなくても種別が分かる。
`mode = full | partial | rbc-method | rbc-type-method | rbc-type-method-object`。

`history` は RUN_ID 単位でアーカイブ:

```
outputs/history/ClientFixTrace/verHist/<mode>/<RUN_ID>/
├── _summary/
│     valid_clone_summary.csv / invalid_clone_summary.csv
│     aggregate_tracking_summary.csv          # Maintained 等の集計
├── _allHistory/
│     <lib>_all_history.json
└── <lib>@<post>/
      ├── success/
      │     version_history-success.json
      │     post_update_tracking-success.json
      │     result_pairs-success.json
      │     sorted/{update,downgrade,same}.json
      └── failure/   （同上, -failure）
```

`latest` は最新 RUN_ID の中身を `<mode>/` 直下へ展開（`<RUN_ID>` 階層は無し）:

```
outputs/latest/ClientFixTrace/verHist/<mode>/
├── _summary/ … _allHistory/ … <lib>@<post>/{success,failure}/
```

- `detect.ts` の `VERSION_DATA_DIR` はこの `<mode>` ルート（例 `.../verHist/full`）を指す。
- `aggregate_tracking_summary.csv` の `Maintained` = 更新後、追跡した後続3リリースの間その版を維持し続けたクライアント数。
- 設計の詳細は `docs/DESIGN.md`（git 管理外）。

---

### Phase 2 — detect（パターン検出）

| コマンド | 内容 |
|---|---|
| `make detect-full` | verHist-full の出力を対象に全件検出（success/failure 両ステート） |
| `make detect-partial` | `datasets/targets.json` に指定したタスクのみ検出（単一ステート） |

検出モード（`DETECT_MODE`、CLI 第2引数）:

| mode | 内容 | 参照する R-BC 出力 |
|---|---|---|
| 0 | コードのみ（型なし広域マッチ） | `method/` |
| 1 | コード + 型完全一致 | `type-method/` |
| **1.5** | 1 と同じマッチングの **no_unknown 厳格版** | `type-method/` の `*_no_unknown` |
| 2 | コード + 型一致 + object キー | `type-method-object/` |
| **2.5** | 2 と同じマッチングの **no_unknown 厳格版** | `type-method-object/` の `*_no_unknown` |

> **`.5` モード（1.5 / 2.5）について**: R-BC は typed モード（DETECTION_MODE 1/2）実行時に
> `<lib>_<ver>/{createPattern,detectByPattern}_no_unknown/` を併せて出力する（unknown 型だけの呼び出し
> パターンを除いた集合）。`.5` はマッチング自体は整数モードと同一で、参照サブディレクトリを `_no_unknown`
> 側に切り替えるだけ。**R-BC 側に新モードは不要**で、`make rbc-type`/`make rbc-obj`（DETECTION_MODE=1/2）で
> 生成済みの出力をそのまま使う。出力は `…-no-unknown` という専用フォルダに分離される。

```sh
make detect-full       # 設定: src/detect.ts CONFIG.FULL
make detect-partial    # 設定: src/detect.ts CONFIG.PARTIAL
```

#### 出力レイアウト（full / partial を分離）

detect も verHist と同様 **runMode をトップに**置き、full と partial の結果が混ざらない:

```
outputs/{history,latest}/ClientFixTrace/detect/<full|partial>/[<RUN_ID>/]<検出mode>/...
  検出mode = method | type-method | type-method-object  (DETECT_MODE 0/1/2)
```

- `history` は `<runMode>/<RUN_ID>/`、`latest` は `<runMode>/` 直下へ展開。
- **partial フォールバック**: `CONFIG.PARTIAL.VERSION_DATA_DIR`（`verHist/partial`）に該当履歴が無い場合、
  `VERSION_DATA_DIR_FALLBACK`（`verHist/full`）を参照する。full は partial を包含するため、
  verHist を full でだけ回していれば partial 検出をそのまま実行できる（空文字で無効化）。

## R-BC との関係

本パイプラインは R-BC の出力（パターンファイル・検出結果）を入力として利用するが、  
**解析対象のデータソースは別物である**点に注意。  

### パターンファイルの種別

| ファイル名 | modeFlag | 内容 |
|---|---|---|
| `failure_detectpatternlist.json` | `0` | 型情報を除去した広域マッチ用パターン |
| `failure_patternList.json` | `1` | 型情報を含む厳密パターン |

どちらのファイルが使われるかはコードが自動判定する（`detectpatternlist.json` を優先）。
