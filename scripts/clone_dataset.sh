#!/bin/bash

set -Ceu

cd ..

# 1. ディレクトリがなければ作成する
if [ ! -d "datasets" ]; then
    echo "datasets ディレクトリが存在しないため作成します。"
    mkdir -p datasets
fi

# 2. ディレクトリが存在しても test_result.json がない場合は取得（クローン）する
if [ ! -f "datasets/test_result.json" ]; then
    echo "test_result.json が見つからないため、リポジトリから取得します..."
    
    git clone https://github.com/Wakayama-SocSEL/Matsuda.git ./datasets/Matsuda
    cp -p ./datasets/Matsuda/output/test_result.json ./datasets/
    rm -rf ./datasets/Matsuda
    
    echo "successfully cloned datasets"
else
    # 既にファイルが存在する場合の処理
    echo "test_result.json already exists"
    exit 0
fi