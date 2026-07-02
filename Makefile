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
# 内部サブルーチン: history → latest コピー（出力がある場合のみ。早期 return 時は skip）
# どちらも <RUN_ID> 階層の中身を latest/<...>/<mode> 直下へ展開する
# ---------------------------------------------------------------
# verHist 用: history/verHist/<mode>/<RUN_ID> → latest/verHist/<mode>
# 引数 $(1) は mode (full / partial / rbc-method / rbc-type-method / rbc-type-method-object)
# 引数 $(1) は mode (full / partial / rbc-method / rbc-type-method / rbc-type-method-object)
define copy_verhist_to_latest
	@if [ -d "$(HISTORY_DIR)/verHist/$(1)/$(BCPG_RUN_ID)" ]; then \
	  mkdir -p $(LATEST_DIR)/verHist; rm -rf $(LATEST_DIR)/verHist/$(1); \
	  cp -r "$(HISTORY_DIR)/verHist/$(1)/$(BCPG_RUN_ID)" "$(LATEST_DIR)/verHist/$(1)"; \
	  echo "[ClientFixTrace] copied: history/ClientFixTrace/verHist/$(1)/$(BCPG_RUN_ID) → latest/ClientFixTrace/verHist/$(1)"; \
	else \
	  echo "[ClientFixTrace] SKIP: history/ClientFixTrace/verHist/$(1)/$(BCPG_RUN_ID) が無い（処理が早期終了した可能性）"; \
	fi
endef

# detect 用: history/detect/<runMode>/<RUN_ID>/<検出modeDir> → latest/detect/<runMode>/<検出modeDir>
# 引数 $(1)=runMode (full/partial)  $(2)=検出modeDir。検出モード単位で分離し別モードを上書きしない。
define copy_detect_to_latest
	@if [ -d "$(HISTORY_DIR)/detect/$(1)/$(BCPG_RUN_ID)/$(2)" ]; then \
	  mkdir -p $(LATEST_DIR)/detect/$(1); rm -rf $(LATEST_DIR)/detect/$(1)/$(2); \
	  cp -r "$(HISTORY_DIR)/detect/$(1)/$(BCPG_RUN_ID)/$(2)" "$(LATEST_DIR)/detect/$(1)/$(2)"; \
	  echo "[ClientFixTrace] copied: history/.../detect/$(1)/$(BCPG_RUN_ID)/$(2) → latest/.../detect/$(1)/$(2)"; \
	else \
	  echo "[ClientFixTrace] SKIP: history/ClientFixTrace/detect/$(1)/$(BCPG_RUN_ID)/$(2) が無い（処理が早期終了した可能性）"; \
	fi
endef

# 検出モード番号 → ディレクトリ名 への共通マッピング
#   0=method / 1=type-method / 2=type-method-object / 1.5,2.5=各 no_unknown 版
define mode_name
$(if $(filter 0,$(1)),method,$(if $(filter 1,$(1)),type-method,$(if $(filter 1.5,$(1)),type-method-no-unknown,$(if $(filter 2.5,$(1)),type-method-object-no-unknown,type-method-object))))
endef

# RBC_MODE(0/1/1.5/2/2.5) → R-BC モード名（verhist-rbc の出力ディレクトリ名に使用）
RBC_MODE ?= 2
RBC_MODE_NAME := $(call mode_name,$(RBC_MODE))
# DETECT_MODE → 検出モード名（detect の latest 分離に使用）
DETECT_MODE_NAME := $(call mode_name,$(DETECT_MODE))

# ---------------------------------------------------------------
# 履歴抽出フェーズ (verHist.ts)
# ---------------------------------------------------------------

verhist-full: ## verHist.ts を full モードで実行
	cd $(SRCDIR) && $(TSN) verHist.ts full
	$(call copy_verhist_to_latest,full)

verhist-partial: ## verHist.ts を partial モードで実行
	cd $(SRCDIR) && $(TSN) verHist.ts partial
	$(call copy_verhist_to_latest,partial)

# R-BC 検出クライアント起点で verHist を実行（test_result 以外のデータ・部分集合向け）
#   RBC_MODE: 0=method / 1=type-method / 2=type-method-object / 1.5,2.5=各 no_unknown 版 (既定 2)
#   入力は outputs/latest/R-BC/<mode>/ の detectedClients（.5 は detectByPattern_no_unknown を参照）
#   出力 mode は rbc-<R-BCモード名>
verhist-rbc: ## verHistFromRBC.ts 実行 (R-BC 検出起点, RBC_MODE=0/1/1.5/2/2.5)
	cd $(SRCDIR) && $(TSN) verHistFromRBC.ts $(RBC_MODE)
	$(call copy_verhist_to_latest,rbc-$(RBC_MODE_NAME))

# ---------------------------------------------------------------
# パターン検出フェーズ (detect.ts)
# ---------------------------------------------------------------
# make detect-full DETECT_MODE=0
detect-full: ## detect.ts full 実行 (DETECT_MODE=0 コード/1 型/2 型+obj/1.5,2.5 各no_unknown)
	cd $(SRCDIR) && $(TSN) detect.ts full $(DETECT_MODE)
	$(call copy_detect_to_latest,full,$(DETECT_MODE_NAME))

# make detect-partial DETECT_MODE=0
detect-partial: ## detect.ts partial 実行 (DETECT_MODE=0 コード/1 型/2 型+obj/1.5,2.5 各no_unknown)
	cd $(SRCDIR) && $(TSN) detect.ts partial $(DETECT_MODE)
	$(call copy_detect_to_latest,partial,$(DETECT_MODE_NAME))

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
