import fs from "fs";
import path from "path";
import { Item } from "./types/Item";
import { loadJsonData_Item, loadJsonData_Client_Ver } from "./utils/loadJson";
import { extractVersion_all } from "./core/extractVersion";
import { create_version_pairs } from "./core/create_version_pairs";
import { extractVersionList } from "./utils/arrayOperation";
import output_json from "./utils/output_json";
import { VersionPair } from "./types/VersionPair";

type RunMode = 'extract' | 'analyze' | 'full';

// アップデートペア用の型定義
interface TargetUpdate {
  libName: string;
  preVersion: string;
  postVersion: string;
}

/**
 * test_result.json のデータから自動的にアップデートペアを抽出する
 * 条件: 同一クライアント内でテストされたバージョンをSemVerでソートし、旧バージョンで "success" となっている隣接ペアを抽出
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

          // 旧バージョンでテストが成功しているか
          const hasOldSuccess = records.some(r => r.L__version === oldV && r.state === 'success');

          if (hasOldSuccess) {
            const key = `${lib}_${oldV}_${newV}`;
            if (!updatesMap.has(key)) {
              // libNameとして使える情報（npm_pkgがある場合はそれ、なければリポジトリ名）を使用
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

async function saveAndAnalyzeData(libTask: TargetUpdate, state: string, dateStr: string, mode: RunMode, verHistory: any[] = [], targetPath: string = "") {
  const { libName, preVersion, postVersion } = libTask;
  const outputDir = path.resolve(process.cwd(), `../output/versionData/${dateStr}/${state}/${libName}-${postVersion}`);
  let population = 0;

  // --- 保存処理 (Extract時) ---
  if ((mode === 'extract' || mode === 'full') && verHistory.length > 0) {
    population = verHistory.length;
    output_json.createOutputDirectory(outputDir);
    const historyPath = output_json.getUniqueOutputPath(outputDir, `version_history-${state}`, `${population}total`);
    fs.writeFileSync(historyPath, JSON.stringify(verHistory, null, 2));
    console.log(`[Extract] Saved ${population} histories for ${state}.`);
  }

  // --- 集計・分類 (Analyze時) ---
  if (mode === 'analyze' || mode === 'full') {
    if (mode === 'analyze' && targetPath.length > 0) {
      console.log(`[Analyze] Loading existing file: ${targetPath}`);
      verHistory = await loadJsonData_Client_Ver(targetPath);
    }

    population = verHistory.length;

    if (population > 0) {
      const inputList = extractVersionList(verHistory);
      const pairs = create_version_pairs(inputList, libName, 1);

      const updateCount = pairs.filter(p => p.type === 'update').reduce((sum, p) => sum + p.count, 0);
      const countSuffix = `${updateCount}updated-${population}total`;

      output_json.createOutputDirectory(outputDir);
      const pairPath = output_json.getUniqueOutputPath(outputDir, `result_pairs-${state}`, countSuffix);
      fs.writeFileSync(pairPath, JSON.stringify(pairs, null, 2));

      Classify_types(pairs, libName, postVersion, dateStr, state, countSuffix);
      console.log(`[Analyze] Classification completed for ${state}: ${countSuffix}`);
    } else {
      console.log(`[Analyze] No history data to analyze for ${state}.`);
    }
  }
}

function Classify_types(data: VersionPair[], libName: string, postLibVersion: string, dateStr: string, state: string, countSuffix: string): void {
  data = [...data].sort((a, b) => b.count - a.count);
  let outDir = path.join('../output/sortData', dateStr, state, `${libName}-${postLibVersion}`);
  output_json.createOutputDirectory(outDir);

  const types: ('update' | 'downgrade' | 'same')[] = ['update', 'downgrade', 'same'];
  types.forEach(type => {
    const filteredData = data.filter((item) => item.type === type);
    const outputPath = output_json.getUniqueOutputPath(outDir, '', `${type}_${countSuffix}`);
    fs.writeFileSync(outputPath, JSON.stringify(filteredData, null, 2));
  });
}

// 実行時間を記録できるように引数（durationSec）を追加
function appendCloneLog(logPath: string, libName: string, preVer: string, postVer: string, succCount: number, failCount: number, status: string, durationSec: number) {
  const logLine = `${libName},${preVer},${postVer},${succCount},${failCount},${status},${durationSec.toFixed(2)}\n`;
  fs.appendFileSync(logPath, logLine, 'utf8');
}

// ==========================================
// 実行セクション
// ==========================================
(async () => {
  const now = new Date();
  const dateStr = output_json.formatDateTime(now);

  const mode: RunMode = 'full';

  // クローン結果出力用の準備
  const cloneResultDir = path.resolve(process.cwd(), `../output/cloneResult/${dateStr}`);
  output_json.createOutputDirectory(cloneResultDir);
  const cloneLogPath = path.join(cloneResultDir, 'clone_summary.csv');
  // ヘッダーに Duration(s) を追加
  fs.writeFileSync(cloneLogPath, 'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status,Duration(s)\n', 'utf8');

  if (mode === 'full' || mode === 'extract') {
    console.log(`[Extract] Loading dataset test_result.json...`);
    const data: Item[] = await loadJsonData_Item('../datasets/test_result.json');
    
    // mydata.json を廃止し、データから自動生成
    const libVersionRanges: TargetUpdate[] = extractUpdatesFromResults(data);
    console.log(`[Init] Extracted ${libVersionRanges.length} target version pairs from dataset.`);

    for (const task of libVersionRanges) {
      const taskStartTime = Date.now(); // タスクごとの処理時間計測開始
      const { libName, preVersion, postVersion } = task;

      const list1 = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(preVersion) && item.state.includes("success")).map(item => item.S__nameWithOwner);
      const list2Succ = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(postVersion) && item.state.includes("success")).map(item => item.S__nameWithOwner);
      const list2Fail = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(postVersion) && item.state.includes("failure")).map(item => item.S__nameWithOwner);

      let clientsSucc = [...new Set(list2Succ.filter(value => list1.includes(value)))];
      let clientsFail = [...new Set(list2Fail.filter(value => list1.includes(value)))];

      // いずれかが0件ならその時点で除外して記録
      if (clientsSucc.length === 0 || clientsFail.length === 0) {
        const taskDuration = (Date.now() - taskStartTime) / 1000;
        console.log(`\n[Skip] Task: ${libName} (${preVersion} -> ${postVersion}) - Not enough clients. [Done in ${taskDuration.toFixed(2)}s]`);
        appendCloneLog(cloneLogPath, libName, preVersion, postVersion, clientsSucc.length, clientsFail.length, 'EXCLUDED_NOT_ENOUGH_DATA', taskDuration);
        continue;
      }

      // // テスト用に最大2件に制限（※全件実行時はこの2行を削除してください）
      // if (clientsSucc.length > 2) clientsSucc = clientsSucc.slice(0, 2);
      // if (clientsFail.length > 2) clientsFail = clientsFail.slice(0, 2);

      console.log(`\nStarting Full Task: ${libName} (${preVersion} -> ${postVersion})`);
      
      console.log(`--- Extracting success clients ---`);
      const historySucc = await extractVersion_all(clientsSucc, libName, postVersion, 'success');
      
      console.log(`--- Extracting failure clients ---`);
      const historyFail = await extractVersion_all(clientsFail, libName, postVersion, 'failure');

      const taskDuration = (Date.now() - taskStartTime) / 1000; // クローン等の処理を含む時間

      // 両方ともクローン＆抽出が1件以上成功したかチェック
      if (historySucc.length > 0 && historyFail.length > 0) {
        console.log(`[Success] Valid clones found. Proceeding to save and analyze...`);
        await saveAndAnalyzeData(task, 'success', dateStr, mode, historySucc);
        await saveAndAnalyzeData(task, 'failure', dateStr, mode, historyFail);
        
        console.log(`[Completed] Task: ${libName} (${preVersion} -> ${postVersion}) [Done in ${taskDuration.toFixed(2)}s]`);
        appendCloneLog(cloneLogPath, libName, preVersion, postVersion, historySucc.length, historyFail.length, 'SUCCESS', taskDuration);
      } else {
        // クローン失敗によりどちらかが0件になった場合、除外してゴミディレクトリを削除
        console.log(`[Exclude] One of the states returned 0 valid histories. Deleting cloned data...`);
        const cleanVersion = postVersion.replace(/[^a-zA-Z0-9]/g, '');
        const repoDir = path.resolve(process.cwd(), `../clientRepos_all/${libName}/${cleanVersion}`);
        
        if (fs.existsSync(repoDir)) {
          fs.rmSync(repoDir, { recursive: true, force: true });
        }
        
        console.log(`[Excluded] Task: ${libName} (${preVersion} -> ${postVersion}) [Done in ${taskDuration.toFixed(2)}s]`);
        appendCloneLog(cloneLogPath, libName, preVersion, postVersion, historySucc.length, historyFail.length, 'EXCLUDED_DUE_TO_ZERO_CLONE', taskDuration);
      }
    }
  } else if (mode === 'analyze') {
    // analyzeモード時
    const historyPath = '../output/versionData/2026-03-01-12-00-00/success/libname/version_history-success-100total.json';
    const fakeTask = { libName: "dummy", preVersion: "1.0.0", postVersion: "2.0.0" };
    await saveAndAnalyzeData(fakeTask, 'success', dateStr, mode, [], historyPath);
  }
})();
//TODO:matchResults.json に記載のあるクライアントに絞って実行してみる