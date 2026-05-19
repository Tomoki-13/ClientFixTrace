# ==============================================================
# LibraryTrace Makefile
# ==============================================================

SHELL   := /bin/bash
SRCDIR  := src
TSN     := npx ts-node

# デフォルトモード (コマンドラインで上書き可能: make detect MODE=partial)
MODE ?= full

# パターン検出モード: 0=コードのみ / 1=型完全一致 / 2=型部分一致
# 例: make detect-full DETECT_MODE=1
DETECT_MODE ?= 0

.PHONY: detect detect-full detect-partial \
        verhist verhist-full verhist-partial \
        help
# ---------------------------------------------------------------
# 準備
# ---------------------------------------------------------------
install:
	npm install

# datasets/test_result.json をクローンして取得
# scripts/clone_dataset.sh が内部で cd .. するため cd scripts してから実行する
clone:
	cd scripts && bash clone_dataset.sh

# ---------------------------------------------------------------
# 履歴抽出フェーズ (verHist.ts)
# ---------------------------------------------------------------

verhist-full: ## verHist.ts を full モードで実行
	cd $(SRCDIR) && $(TSN) verHist.ts full

verhist-partial: ## verHist.ts を partial モードで実行
	cd $(SRCDIR) && $(TSN) verHist.ts partial

# ---------------------------------------------------------------
# パターン検出フェーズ (detect.ts)
# ---------------------------------------------------------------
# 例: make detect-full DETECT_MODE=1
# make detect-full DETECT_MODE=0
detect-full: ## detect.ts を full モードで実行 (DETECT_MODE=0/1/2)
	cd $(SRCDIR) && $(TSN) detect.ts full $(DETECT_MODE)

# make detect-partial DETECT_MODE=0
detect-partial: ## detect.ts を partial モードで実行 (DETECT_MODE=0/1/2)
	cd $(SRCDIR) && $(TSN) detect.ts partial $(DETECT_MODE)

# ---------------------------------------------------------------
# ヘルプ
# ---------------------------------------------------------------

help: ## このヘルプを表示
	@echo ""
	@echo "LibraryTrace — 使用可能なコマンド一覧"
	@echo "────────────────────────────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "MODE 変数でモードを切り替えられます (デフォルト: full)"
	@echo "  例: make detect MODE=partial"
	@echo ""

.DEFAULT_GOAL := help
