import { Item } from "../types/Item";
import { Client_Ver } from "../types/VersionCommits";
import versionUtil from "./versionUtil";

export interface TargetUpdate {
  libName: string;
  preVersion: string;
  postVersion: string;
}

/**
 * 2重配列の重複ペアを削除する
 */
function removeDuplicatePairs(pairs: string[][]): string[][] {
  const seen = new Map<string, string[]>();
  for (const arr of pairs) {
    const key = JSON.stringify(arr);
    if (!seen.has(key)) seen.set(key, arr);
  }
  return Array.from(seen.values());
}

/**
 * Client_Ver[] から各クライアントのバージョン履歴リストを抽出する
 */
function extractVersionList(data: Client_Ver[]): string[][] {
  return data.map(item => {
    const list = item.verList || [];
    return list.length > 1 ? list.map(v => v.L_libVersion) : [];
  });
}

/**
 * データセット(Item[])から、解析対象となる「旧Ver(success) -> 新Ver」のペアを抽出する
 */
function extractUpdateTasks(testResults: Item[]): TargetUpdate[] {
  const updatesMap = new Map<string, TargetUpdate>();
  const libClientMap = new Map<string, Map<string, Item[]>>();

  // 1. ライブラリ別・クライアント別にデータをグルーピング
  for (const record of testResults) {
    const lib = record.L__nameWithOwner;
    const client = record.S__nameWithOwner;

    if (!libClientMap.has(lib)) libClientMap.set(lib, new Map());
    const clientMap = libClientMap.get(lib)!;

    if (!clientMap.has(client)) clientMap.set(client, []);
    clientMap.get(client)!.push(record);
  }

  // 2. 各クライアントの履歴を走査してアップデートポイントを特定
  for (const [lib, clientMap] of libClientMap.entries()) {
    for (const [client, records] of clientMap.entries()) {
      // 当該クライアントの全バージョンを取得し、SemVer順にソート
      const versions = versionUtil.sort(records.map(r => r.L__version));

      if (versions.length >= 2) {
        for (let i = 0; i < versions.length - 1; i++) {
          const oldV = versions[i];
          const newV = versions[i + 1];

          // 「前のバージョン(oldV)での実行状態が success であること」を条件に抽出
          const hasOldSuccess = records.some(r => r.L__version === oldV && r.state === 'success');

          if (hasOldSuccess) {
            const key = `${lib}_${oldV}_${newV}`;
            if (!updatesMap.has(key)) {
              // npmパッケージ名が取得できる場合はそれを使用、なければWithOwnerを使用
              const libName = (records.find(r => r.L__version === newV) as any)?.L__npm_pkg || lib;
              updatesMap.set(key, { libName, preVersion: oldV, postVersion: newV });
            }
          }
        }
      }
    }
  }
  return Array.from(updatesMap.values());
}

export default { removeDuplicatePairs, extractVersionList, extractUpdateTasks };