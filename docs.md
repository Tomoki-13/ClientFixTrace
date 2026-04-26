# JavaScriptライブラリ破壊的変更解析パイプライン仕様書

本ドキュメントは、JavaScriptライブラリの更新に伴う破壊的変更（Breaking Changes）の影響を、クライアントコードのAST解析を通じて特定・追跡するためのシステム構成について記述したものです。

---

## 1. システム概要
本パイプラインは、膨大なOSSプロジェクトの中から「特定のライブラリ更新によって影響を受けた箇所」を自動で特定し、その修正過程を追跡することを目的としています。解析は大きく分けて「履歴走査（specific_setup.ts）」と「パターン検出（detect_flow.ts）」の2つのフェーズで構成されます。

---

## 2. specific_setup.ts：履歴走査フェーズ

### 概要
対象ライブラリを利用している全クライアントリポジトリのコミットログを遡り、依存関係の「更新地点」を特定します。

### 入力データ
- **ソースリポジトリ群**: `../clientRepos/{libName}/{user}/{repo}`
- **解析対象ステータス**: 
    - `failure` (破壊的変更の影響が疑われるビルド失敗等の状態)
    - `success` (ビルド成功)

### 処理ロジック
- 各リポジトリの `package.json` を全コミットにわたって走査。
- 依存ライブラリのバージョンがターゲット以上に書き換わった直後のコミットID（`C_commitID`）を抽出。
- 更新後、クライアント側で最も近い位置にあるリリースタグが付与されたコミットID（`C_tagCommitID`）を特定。

### 出力データ
- `version_history-{state}.json`: クライアントごとの依存関係更新履歴。

---

## 3. detect_flow.ts：パターン検出フェーズ

### 概要
特定された更新地点（update）とリリース地点（release）の2地点において、AST解析エンジンを用いて破壊的変更のシグネチャ（パターン）を検出します。

### 主要な処理プロセス
1. **クライアントのフィルタリング**
   - API一致結果と更新履歴を照合し、真に解析が必要なリポジトリのみを抽出。
2. **パターンの正規化 (Normalization)**
   - `patternList.json` 内に見られる「配列の二重入れ子」構造を自動検知し、`flatMap` を用いて解析エンジン（typeAwarePatternMatch）が処理可能な3階層構造（Pattern > Group > Block）へ自動修復。
3. **2地点同時解析**
   - **Update地点**: ライブラリ更新直後のコード。
   - **Release地点**: 更新後、修正が含まれている可能性のあるリリース後のコード。
4. **環境のクリーンアップ**
   - 解析実行前に作業ディレクトリを `fs.rmSync` で初期化。過去のデータ残骸を排除し、統計値（alldirs）の正確性を担保。

---

## 4. ディレクトリ構造と設計仮説

### 入力ディレクトリ (`clientRepos/`)
階層：`{libName}/{user}/{repo}`

**【設計上の仮説：名前空間の隔離とエコシステムの維持】**
リポジトリをフラットに並べず `user/repo` の3層構造を維持するのは、**「同名リポジトリによる衝突の回避」**と**「プロジェクトコンテキストの保持」**を目的としている。
- 同じ `cassava` という名前のリポジトリでも、開発者が異なればライブラリの使用パターンも異なる。
- この構造を維持することで、将来的に「どのユーザー層が修正を放置しやすいか」といった開発者属性に基づいた相関分析が可能になる。

### 作業・出力ディレクトリ (`client_update/` および `results/`)
階層：`{libName}-{version}_{state}/{update|release}`

**【設計上の仮説：時間軸における不変性の検証】**
同一の親ディレクトリ内に `update`（更新直後）と `release`（最寄りリリース）を並列配置するのは、**「時間経過による修正の有無（Temporal Diff）」**を最小コストで抽出するためである。
- 親ディレクトリをライブラリ・バージョン・ステータス（Success/Failure）で固定することで、環境変数を固定した実験系を構築。
- `update` と `release` の検出数が一致（Delta=0）した場合、それは**「開発者が依存関係を更新したが、コードの不適合を認識・修正せずにリリースまで至った（Passive Update現象）」**という仮説を証明する重要な証拠となる。

---

## 5. デバッグ・修正済み重要事項

> **[重要] blockGroup is not iterable への対処**
> データソース（patternList.json）の階層が、一部のライブラリ（vinyl等）で予期せず深くなっていた問題を解消。
`Group` 階層を保護しつつ `Block` 内の配列を平坦化することで、エンジン側のクラッシュを防止。

## 6. ディレクトリ構成詳細版
```text
.
├── datasets/
│   ├── [IN] mydata.json           # 解析対象タスクリスト
│   └── analysis_target/
│       ├── current/
│       │   └── {datetime}/
│       │       └── [IN] version_history-{state}.json  # specific_setup.tsの成果物
│       └── rbc_data/
│           └── {datetime}/
│               └── {lib}_{ver}/
│                   ├── [IN] matchResults.json        # 事前キーワードマッチ結果
│                   └── [IN] patternList.json         # AST検出パターン
├── clientRepos/                      #　[IN] 解析用ソースリポジトリ（3層構造）
│   └── {libName}/
│       └── {user}/
│           └── {repo}/
├── client_update/                    # 作業用一時ディレクトリ
│   └── {libName}-{version}_{state}/
│       ├── update/                   # 更新直後のコードを保持
│       └── release/                  # 最寄りリリースのコードを保持
└── output/
    └── specificData/
        └── {datetime}/
            ├── [OUT] specific-commits/  # 抽出された母数リスト(JSON)
            └── [OUT] results/           # AST解析の最終結果
                └── {libName}-{version}_{state}/
                      ├── update/     # 更新直後の検出数・箇所
                      └── release/    # リリース後の検出数・箇所
```

## 7. 入力による処理の変化とrbc-dataの見分け方（detect_flow）
ほぼ関数単位での検出では,createの方にpatternListとdetectpatternlistの両方が含まれる．
使用されるのは，detectpatternlistという型情報を取り除いてパターン化したもの

型を含む場合にはpatternListtのみ存在する
これにより，検出粒度を分けている

** また，入力ファイルの問題で以下のように，失敗にも検出を当てるsupportの方を実行するように！！ **

await support_detectByPattern(getPatternDir, detectPatternDir, libName, lastpatterns, detect_outputDir, true, 1);
安定版rbc_commit: 7111254b5c3b9ca83f6b874e265489968369d9a9 (HEAD -> main, origin/main, origin/HEAD)
## 8注意点
R-BCと関係しているように見えるが，データの元が違う点に注意


