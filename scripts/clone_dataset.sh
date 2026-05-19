#!/bin/bash

set -Ceu

cd ..
if [ -f "datasets/test_result.json" ]; then
    echo "test_result.json already exists"
    exit 0
fi

mkdir -p datasets

git clone https://github.com/Wakayama-SocSEL/Matsuda.git ./datasets/Matsuda
cp -p ./datasets/Matsuda/output/test_result.json ./datasets/
rm -rf ./datasets/Matsuda

echo "successfully cloned datasets"