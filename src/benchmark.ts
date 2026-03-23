import fs from "fs";
import path from "path";
import { Item } from "./types/Item";
import { Client_Ver } from "./types/VersionCommits";

// utils・core はすべてオブジェクトとしてインポート
import LoadJson from "./utils/loadJson";
import ExtractVersion from "./core/extractVersion";

// ==========================================
// INPUT: ベンチマーク設定
// ==========================================
const CONFIG = {
  // 読み込むテスト結果データセットのパス
  testResultPath: '../datasets/test_result.json',
  // テスト対象のライブラリ（対象クライアントを絞り込むため）
  targetLibrary: 'uuid',
  benchmarkLimit: 20,
  // 並列実行時の同時実行数
  parallelConcurrency: 5
};

/**
 * アップデートペア用の型定義
 */
interface TargetUpdate {
  libName: string;
  preVersion: string;
  postVersion: string;
}

/**
 * データセットから対象ライブラリ・バージョンのペアを抽出する関数
 * 条件: 同一クライアント内で、旧バージョンが success である隣接ペアを抽出
 */
function extractUpdatesFromResults(testResults: Item[]): TargetUpdate[] {
  const updatesMap = new Map<string, TargetUpdate>();
  const libClientMap = new Map<string, Map<string, Item[]>>();

  for (const record of testResults) {
    const lib = record.L__nameWithOwner;
    const client = record.S__nameWithOwner;

    if (!libClientMap.has(lib)) libClientMap.set(lib, new Map());
    const clientMap = libClientMap.get(lib)!;

    if (!clientMap.has(client)) clientMap.set(client, []);
    clientMap.get(client)!.push(record);
  }

  for (const [lib, clientMap] of libClientMap.entries()) {
    for (const [client, records] of clientMap.entries()) {
      // SemVerの仕様に基づいたカスタムソート
      const versions = [...new Set(records.map(r => r.L__version))].sort((a, b) => {
        const parseVer = (v: string) => {
          const dashIdx = v.indexOf('-');
          const main = dashIdx > -1 ? v.slice(0, dashIdx) : v;
          const pre = dashIdx > -1 ? v.slice(dashIdx + 1) : '';
          return { parts: main.split('.').map(Number), pre };
        };

        const vA = parseVer(a);
        const vB = parseVer(b);

        for (let i = 0; i < Math.max(vA.parts.length, vB.parts.length); i++) {
          const numA = vA.parts[i] || 0;
          const numB = vB.parts[i] || 0;
          if (numA !== numB) return numA - numB;
        }

        if (vA.pre && !vB.pre) return -1;
        if (!vA.pre && vB.pre) return 1;
        if (vA.pre && vB.pre) return vA.pre.localeCompare(vB.pre, undefined, { numeric: true, sensitivity: 'base' });
        return 0;
      });

      if (versions.length >= 2) {
        for (let i = 0; i < versions.length - 1; i++) {
          const oldV = versions[i];
          const newV = versions[i + 1];
          // 旧バージョンでテストが成功しているか確認
          const hasOldSuccess = records.some(r => r.L__version === oldV && r.state === 'success');

          if (hasOldSuccess) {
            const key = `${lib}_${oldV}_${newV}`;
            if (!updatesMap.has(key)) {
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

(async () => {
  console.log(`[Init] Loading dataset ${CONFIG.testResultPath}...`);
  // LoadJson.item を使用
  const data: Item[] = await LoadJson.item(CONFIG.testResultPath);

  let libVersionRanges = extractUpdatesFromResults(data);
  if (CONFIG.targetLibrary) {
    libVersionRanges = libVersionRanges.filter(task =>
      task.libName.includes(CONFIG.targetLibrary) || CONFIG.targetLibrary.includes(task.libName)
    );
  }

  // 重複のないクライアントリストを作成
  const masterClientSet = new Set<string>();
  for (const task of libVersionRanges) {
    const list1 = data.filter(item => item.L__nameWithOwner.includes(task.libName) && item.L__version.includes(task.preVersion) && item.state === "success").map(item => item.S__nameWithOwner);
    const list2 = data.filter(item => item.L__nameWithOwner.includes(task.libName) && item.L__version.includes(task.postVersion)).map(item => item.S__nameWithOwner);
    const clients = [...new Set(list2.filter(value => list1.includes(value)))];
    clients.forEach(c => masterClientSet.add(c));
  }

  // ベンチマーク用に件数を制限
  const allClients = Array.from(masterClientSet).slice(0, CONFIG.benchmarkLimit);

  if (allClients.length === 0) {
    console.log(`[Exit] No valid clients found.`);
    return;
  }

  console.log(`\n==================================================`);
  console.log(`[Benchmark & Verification] (Seq vs Par)`);
  console.log(`==================================================`);

  // --- 1. 直列処理 (Concurrency: 1) ---
  console.log(`\n--- Running Sequential (Concurrency: 1) ---`);
  const seqStart = Date.now();
  // ExtractVersion.extractVersion_ben を使用。clonedata/repos/master_seq に保存される
  const seqResult = await ExtractVersion.extractVersion_ben(allClients, CONFIG.targetLibrary, 1, '_seq');
  const seqDuration = (Date.now() - seqStart) / 1000;

  // --- 2. 並列処理 (Concurrency: 設定値) ---
  console.log(`\n--- Running Parallel (Concurrency: ${CONFIG.parallelConcurrency}) ---`);
  const parStart = Date.now();
  // ExtractVersion.extractVersion_ben を使用。clonedata/repos/master_par に保存される
  const parResult = await ExtractVersion.extractVersion_ben(allClients, CONFIG.targetLibrary, CONFIG.parallelConcurrency, '_par');
  const parDuration = (Date.now() - parStart) / 1000;

  // --- 3. 検証 (Verification) ---
  console.log(`\n==================================================`);
  console.log(`[Verification Results]`);

  // A. データ件数の比較
  const isCountMatch = seqResult.length === parResult.length;
  console.log(`- Data Count Match: ${isCountMatch ? '✅ OK' : '❌ NG'} (Seq: ${seqResult.length}, Par: ${parResult.length})`);

  // B. 履歴内容（JSONデータ）の不一致チェック
  // クライアント名でソートして、取得された履歴の内容が完全に一致するか検証
  const seqJson = JSON.stringify(seqResult.sort((a, b) => a.C_client.localeCompare(b.C_client)));
  const parJson = JSON.stringify(parResult.sort((a, b) => a.C_client.localeCompare(b.C_client)));
  const isContentMatch = seqJson === parJson;
  console.log(`- History Content Match: ${isContentMatch ? '✅ OK' : '❌ NG'}`);

  // C. ディスク上のクローン済みリポジトリ数の確認
  const checkStorage = (suffix: string) => {
    // 新しいディレクトリ構成に合わせてパスを指定
    const baseDir = path.resolve(process.cwd(), `./clonedata/repos/master${suffix}/${CONFIG.targetLibrary}`);
    if (!fs.existsSync(baseDir)) return 0;
    
    let count = 0;
    const users = fs.readdirSync(baseDir);
    for (const user of users) {
      const userPath = path.join(baseDir, user);
      if (fs.statSync(userPath).isDirectory()) {
        count += fs.readdirSync(userPath).length;
      }
    }
    return count;
  };

  const seqFiles = checkStorage('_seq');
  const parFiles = checkStorage('_par');
  console.log(`- Cloned Repos on Disk: ${seqFiles === parFiles && seqFiles > 0 ? '✅ OK' : '❌ NG'} (Seq: ${seqFiles}, Par: ${parFiles})`);

  // --- 4. パフォーマンス結果出力 ---
  console.log(`\n[Performance Results]`);
  console.log(`Sequential Time : ${seqDuration.toFixed(2)}s`);
  console.log(`Parallel Time   : ${parDuration.toFixed(2)}s`);
  console.log(`Speedup         : ${(seqDuration / parDuration).toFixed(2)}x faster`);
  console.log(`==================================================\n`);
})();