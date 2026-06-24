#!/bin/bash

# datasets/ は親ディレクトリ（BCPatternGen メタリポ）配下に作成される
# 単体実行は現在サポートされない（README 参照）

set -Ceu

# スクリプト自身の位置からメタリポルートを解決（呼び出し位置に依存しない）
# research-meta/ClientFixTrace/scripts/ → research-meta/
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
META_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

DATASETS_DIR="$META_ROOT/datasets"
TARGET_FILE="$DATASETS_DIR/test_result.json"

echo "[clone-dataset] meta root : $META_ROOT"
echo "[clone-dataset] target    : $TARGET_FILE"

# 1. datasets ディレクトリの存在確認・作成
if [ ! -d "$DATASETS_DIR" ]; then
    echo "[clone-dataset] datasets/ が無いため作成します"
    mkdir -p "$DATASETS_DIR"
fi

# 2. test_result.json の存在確認（あれば何もしない）
if [ -f "$TARGET_FILE" ]; then
    echo "[clone-dataset] test_result.json already exists（取得をスキップ）"
    exit 0
fi

# 3. 取得
echo "[clone-dataset] test_result.json が無いため取得します..."
git clone https://github.com/Wakayama-SocSEL/Matsuda.git "$DATASETS_DIR/Matsuda"
cp -p "$DATASETS_DIR/Matsuda/output/test_result.json" "$DATASETS_DIR/"
rm -rf "$DATASETS_DIR/Matsuda"

echo "[clone-dataset] successfully cloned → $TARGET_FILE"
