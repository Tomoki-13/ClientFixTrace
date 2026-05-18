// core/create_version_pairs.ts
import { VersionPair } from "../types/VersionPair";
import VersionUtil from "../analysis/versionUtil";
import dataProcessor from "../utils/dataProcessor";

// [[1.1.0,2.0.0,2.1.1],[2.0.0,3.0.0,4.0.0,5.0.0]] のようなクライアントごとのバージョン結果が出力
// クライアントごとにバージョン履歴を取得する 0：クライアント内の重複あり　１：クライアント内の重複なし
const create_version_pairs = (verList: string[][], libName: string, mode: number = 0): VersionPair[] => {
  let pairs: string[][] = [];

  for (const ver of verList) {
    let currentPairs: string[][] = [];
    for (let i = 0; i < ver.length - 1; i++) {
      currentPairs.push([ver[i], ver[i + 1]]);
    }
    pairs = pairs.concat(mode === 1 ? dataProcessor.removeDuplicatePairs(currentPairs) : currentPairs);
  }

  const pairCount = new Map<string, number>();
  pairs.forEach(p => {
    const key = JSON.stringify(p);
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  });

  return dataProcessor.removeDuplicatePairs(pairs)
    .sort((a, b) => {
      const res0 = VersionUtil.compare(a[0], b[0]);
      const firstDiff = res0.find(d => d !== 0);
      if (firstDiff !== undefined) return firstDiff;
      const res1 = VersionUtil.compare(a[1], b[1]);
      return res1.find(d => d !== 0) || 0;
    })
    .map(p => ({
      // pをそのまま渡さず、[p[0], p[1]] とすることでタプル型エラーを回避
      type: VersionUtil.judgeUpOrDown([p[0], p[1]]),
      from: p[0],
      to: p[1],
      count: pairCount.get(JSON.stringify(p)) || 0
    }));
};

export default {
  create_version_pairs
};