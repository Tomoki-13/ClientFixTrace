# LibraryTrace

JavaScriptライブラリの更新に伴う破壊的変更（Breaking Changes）の影響を、  
クライアントコードのAST解析を通じて特定・追跡するパイプライン。

---
## セットアップ

```sh
npm install
```

依存する R-BC エンジンの安定版コミット(202604):
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

```sh

以下のいずれかを実行
make verhist-full
make verhist-partial
```

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
