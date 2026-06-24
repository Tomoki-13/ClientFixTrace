# ==============================================================
# ClientFixTrace Makefile
# ==============================================================

SHELL   := /bin/bash
SRCDIR  := src
TSN     := npx ts-node

# デフォルトモード (コマンドラインで上書き可能: make detect MODE=partial)
MODE ?= full

# パターン検出モード: 0=コードのみ / 1=型完全一致 / 2=型+objectキー
#   make detect-full DETECT_MODE=0   # コードのみ
#   make detect-full DETECT_MODE=1   # 型完全一致
#   make detect-full DETECT_MODE=2   # 型+objectキー
DETECT_MODE ?= 0

# 実行 ID: 親 Make から渡されたものを利用、未設定ならここで生成
# 出力は ../outputs/history/ClientFixTrace/<verHist|detect>/<BCPG_RUN_ID>/ に書かれ、その後 ../outputs/latest/ClientFixTrace/ にコピーされる
BCPG_RUN_ID ?= $(shell date +%Y-%m-%d-%H-%M-%S)
export BCPG_RUN_ID

LATEST_DIR  := ../outputs/latest/ClientFixTrace
HISTORY_DIR := ../outputs/history/ClientFixTrace

.PHONY: install clone \
        detect detect-full detect-partial \
        verhist verhist-full verhist-partial verhist-rbc \
        help

# ---------------------------------------------------------------
# 準備
# ---------------------------------------------------------------
install: ## 依存パッケージのインストール
	npm install

# datasets/test_result.json をクローンして取得（親リポの datasets/ に配置される）
clone: ## datasets の取得
	cd scripts && bash clone_dataset.sh

# ---------------------------------------------------------------
# 内部サブルーチン: history → latest コピー
# 引数 $(1) は対象ディレクトリ名 (verHist / detect)
# ---------------------------------------------------------------
define copy_to_latest
	@mkdir -p $(LATEST_DIR)
	rm -rf $(LATEST_DIR)/$(1)
	cp -r $(HISTORY_DIR)/$(1)/$(BCPG_RUN_ID) $(LATEST_DIR)/$(1)
	@echo "[ClientFixTrace] copied: history/ClientFixTrace/$(1)/$(BCPG_RUN_ID) → latest/ClientFixTrace/$(1)"
endef

# ---------------------------------------------------------------
# 履歴抽出フェーズ (verHist.ts)
# ---------------------------------------------------------------

verhist-full: ## verHist.ts を full モードで実行
	cd $(SRCDIR) && $(TSN) verHist.ts full
	$(call copy_to_latest,verHist)

verhist-partial: ## verHist.ts を partial モードで実行
	cd $(SRCDIR) && $(TSN) verHist.ts partial
	$(call copy_to_latest,verHist)

# R-BC 検出クライアント起点で verHist を実行（test_result 以外のデータ・部分集合向け）
#   RBC_MODE: 0=method / 1=type-method / 2=type-method-object (既定 2)
#   入力は outputs/latest/R-BC/<mode>/ の detectedClients
verhist-rbc: ## verHistFromRBC.ts 実行 (R-BC 検出起点, RBC_MODE=0/1/2)
	cd $(SRCDIR) && $(TSN) verHistFromRBC.ts $(or $(RBC_MODE),2)
	$(call copy_to_latest,verHist)

# ---------------------------------------------------------------
# パターン検出フェーズ (detect.ts)
# ---------------------------------------------------------------
# make detect-full DETECT_MODE=0
detect-full: ## detect.ts full 実行 (DETECT_MODE=0 コードのみ / 1 型完全一致 / 2 型+objectキー)
	cd $(SRCDIR) && $(TSN) detect.ts full $(DETECT_MODE)
	$(call copy_to_latest,detect)

# make detect-partial DETECT_MODE=0
detect-partial: ## detect.ts partial 実行 (DETECT_MODE=0 コードのみ / 1 型完全一致 / 2 型+objectキー)
	cd $(SRCDIR) && $(TSN) detect.ts partial $(DETECT_MODE)
	$(call copy_to_latest,detect)

# ---------------------------------------------------------------
# ヘルプ
# ---------------------------------------------------------------

help: ## このヘルプを表示
	@echo ""
	@echo "ClientFixTrace — 使用可能なコマンド一覧"
	@echo "────────────────────────────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""

.DEFAULT_GOAL := help
