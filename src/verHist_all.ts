import fs from "fs";
import path from "path";
import { Item } from "./types/Item";
import { VersionPair } from "./types/VersionPair";

// utils・core はすべてオブジェクトとしてインポート
import loadJson from "./utils/loadJson";
import extractVersion from "./core/extractVersion";
import createVersionPairs from "./core/create_version_pairs";
import outputJson from "./utils/output_json";
import dataProcessor from "./utils/dataProcessor";
import targetCommits from "./utils/targetCommits"; // ターゲット抽出用
import versionUtil from "./utils/versionUtil";     // バージョン正規化用

type RunMode = 'extract' | 'analyze' | 'full';

// ==========================================
// INPUT: 実行設定
// ==========================================
const CONFIG = {
  // 実行モードの指定
  // 'extract' : GitHubからクローンして履歴JSONを生成するだけ
  // 'analyze' : 既存の履歴JSONを読み込み、分類(sortData)のみを行う
  // 'full'    : 抽出から分類まで一貫して実行する
  mode: 'full' as RunMode,

  // 全体的な出力のベースディレクトリ
  outputBaseDir: '../output/sampleTest',
  // テスト結果データセットのパス
  testResultPath: '../datasets/test_result.json',

  // 抽出対象とするライブラリの指定 (例: 'uuid')
  // 空文字 '' に設定すると、データセット内の全ライブラリを対象に実行する
  targetLibrary: 'uuid',

  // ----------------------------------------
  // [analyze モード専用設定]
  // ----------------------------------------
  // 既存の履歴JSONファイルのパス。このデータを使って分類を再実行します。
  analyzeTargetHistoryPath: '../output/versionData/2026-03-01-12-00-00/success/libname/version_history-success-14total.json',
  analyzeState: 'failure',
  analyzeLibName: 'Brightspace', 
  analyzePostVersion: '3.1.0'
};
// ==========================================


/**
 * データの保存と解析（分類）を行う補助関数
 */
async function saveAndAnalyzeData(libTask: any, state: string, dateStr: string, mode: RunMode, verHistory: any[] = [], targetPath: string = "") {
  const { libName, preVersion, postVersion } = libTask;
  const outputDir = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/versionData/${dateStr}/${state}/${libName}-${postVersion}`);
  let population = 0;

  // --- EXTRACT フェーズ (履歴JSONの保存) ---
  if ((mode === 'extract' || mode === 'full') && verHistory.length > 0) {
    population = verHistory.length;
    outputJson.createDir(outputDir);
    const historyPath = outputJson.getUniquePath(outputDir, `version_history-${state}`, `${population}total`);
    fs.writeFileSync(historyPath, JSON.stringify(verHistory, null, 2));
    console.log(`  [Extract] Saved ${population} histories for ${state}.`);
  }

  // --- ANALYZE フェーズ (ペア作成と分類保存) ---
  if (mode === 'analyze' || mode === 'full') {
    if (mode === 'analyze' && targetPath.length > 0) {
      console.log(`  [Analyze] Loading existing file: ${targetPath}`);
      if (fs.existsSync(targetPath)) {
        verHistory = await loadJson.clientVer(targetPath);
      } else {
        console.error(`  [Error] analyzeTargetHistoryPath does not exist.`);
        return;
      }
    }

    population = verHistory.length;

    if (population > 0) {
      // targetCommits で今回のタスクの移行タイミングだけを抽出
      const targets = targetCommits.get(verHistory, libName, postVersion);
      const inputList: string[][] = [];

      for (const t of targets) {
        // バージョンを正規化する（例: "^8.2.0 || ^9.0" -> "8.2.0 || 9.0.0"）
        const normPre = versionUtil.normalize(t.L_preLibVersion);
        const normPost = versionUtil.normalize(t.L_postLibVersion);
        inputList.push([normPre, normPost]);
      }

      // ペアの集計
      const pairs = createVersionPairs.create_version_pairs(inputList, libName, 1);
      const updateCount = pairs.filter(p => p.type === 'update').reduce((sum, p) => sum + p.count, 0);
      const countSuffix = `${updateCount}updated-${population}total`;

      outputJson.createDir(outputDir);
      const pairPath = outputJson.getUniquePath(outputDir, `result_pairs-${state}`, countSuffix);
      fs.writeFileSync(pairPath, JSON.stringify(pairs, null, 2));

      classifyTypes(pairs, libName, postVersion, dateStr, state, countSuffix);
      console.log(`  [Analyze] Classification completed for ${state} (Suffix: ${countSuffix})`);
    } else {
      console.log(`  [Analyze] No history data to analyze for ${state}.`);
    }
  }
}

/**
 * 種別ごとにデータを分類して保存
 */
function classifyTypes(data: VersionPair[], libName: string, postLibVersion: string, dateStr: string, state: string, countSuffix: string): void {
  data = [...data].sort((a, b) => b.count - a.count);
  let outDir = path.join(`${CONFIG.outputBaseDir}/sortData`, dateStr, state, `${libName}-${postLibVersion}`);
  outputJson.createDir(outDir);

  const types: ('update' | 'downgrade' | 'same')[] = ['update', 'downgrade', 'same'];
  types.forEach(type => {
    const filteredData = data.filter((item) => item.type === type);
    const outputPath = outputJson.getUniquePath(outDir, '', `${type}_${countSuffix}`);
    fs.writeFileSync(outputPath, JSON.stringify(filteredData, null, 2));
  });
}

/**
 * 実行結果をCSVに追記
 */
function appendCloneLog(logPaths: string[], libName: string, preVer: string, postVer: string, succCount: number, failCount: number, status: string, durationSec: number) {
  const logLine = `${libName},${preVer},${postVer},${succCount},${failCount},${status},${durationSec.toFixed(2)}\n`;
  for (const logPath of logPaths) {
    fs.appendFileSync(logPath, logLine, 'utf8');
  }
}

// ==================================================
// メイン実行部
// ==================================================
(async () => {
  const dateStr = outputJson.formatDateTime(new Date());

  console.log(`\n==================================================`);
  console.log(`[Run Mode] ${CONFIG.mode.toUpperCase()}`);
  console.log(`==================================================`);

  // ---------------------------------------------------------
  // [パターン A] extract または full モード
  // ---------------------------------------------------------
  if (CONFIG.mode === 'full' || CONFIG.mode === 'extract') {
    const cloneResultDir = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/cloneResult/${dateStr}`);
    const versionDataRoot = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/versionData/${dateStr}`);
    outputJson.createDir(cloneResultDir);
    outputJson.createDir(versionDataRoot);

    const validCloneLogPath = path.join(cloneResultDir, 'valid_clone_summary.csv');
    const invalidCloneLogPath = path.join(cloneResultDir, 'invalid_clone_summary.csv');
    const csvHeader = 'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status,Duration(s)\n';

    fs.writeFileSync(validCloneLogPath, csvHeader, 'utf8');
    fs.writeFileSync(invalidCloneLogPath, csvHeader, 'utf8');

    console.log(`[Init] Loading dataset: ${CONFIG.testResultPath}`);
    const data: Item[] = await loadJson.item(CONFIG.testResultPath);

    let libVersionRanges = dataProcessor.extractUpdateTasks(data);
    console.log(`[Init] Extracted ${libVersionRanges.length} total valid version pairs from dataset.`);

    if (CONFIG.targetLibrary) {
      libVersionRanges = libVersionRanges.filter(task => task.libName.includes(CONFIG.targetLibrary));
      console.log(`[Init] Filtered by targetLibrary '${CONFIG.targetLibrary}'. Processing ${libVersionRanges.length} pairs.`);
    } else {
      console.log(`[Init] targetLibrary is empty. Processing ALL ${libVersionRanges.length} pairs.`);
    }

    if (libVersionRanges.length === 0) return;

    const masterClientSet = new Set<string>();
    const pairClientMap = new Map<string, { succ: string[], fail: string[] }>();

    // [修正箇所] 文字列の厳密な一致ではなく、npm_pkg 名の一致または部分一致で判定する
    const matchLib = (item: Item, targetLib: string) => 
      (item.L__npm_pkg && item.L__npm_pkg === targetLib) || item.L__nameWithOwner.includes(targetLib);

    // 対象タスクのクライアントを重複なしで収集
    for (const task of libVersionRanges) {
      const { libName, preVersion, postVersion } = task;

      const list1 = data.filter(item => matchLib(item, libName) && item.L__version === preVersion && item.state === "success").map(item => item.S__nameWithOwner);
      const list2Succ = data.filter(item => matchLib(item, libName) && item.L__version === postVersion && item.state === "success").map(item => item.S__nameWithOwner);
      const list2Fail = data.filter(item => matchLib(item, libName) && item.L__version === postVersion && item.state === "failure").map(item => item.S__nameWithOwner);

      const clientsSucc = [...new Set(list2Succ.filter(value => list1.includes(value)))];
      const clientsFail = [...new Set(list2Fail.filter(value => list1.includes(value)))];

      // [仕様維持] 成功と失敗の両方が最低1人以上いるペアに限定
      if (clientsSucc.length > 0 && clientsFail.length > 0) {
        clientsSucc.forEach(c => masterClientSet.add(c));
        clientsFail.forEach(c => masterClientSet.add(c));
        pairClientMap.set(`${preVersion}_${postVersion}`, { succ: clientsSucc, fail: clientsFail });
      }
    }

    const allClients = Array.from(masterClientSet);
    if (allClients.length === 0) {
      console.log(`[Exit] No valid clients found.`);
      return;
    }

    console.log(`\n[Master Extract] Starting extraction for ${allClients.length} unique clients...`);
    const masterExtractStartTime = Date.now();
    const masterHistory = await extractVersion.extractVersion_master(allClients, CONFIG.targetLibrary || "all_libraries");
    console.log(`[Master Extract] Completed in ${((Date.now() - masterExtractStartTime) / 1000).toFixed(2)}s.`);

    for (const task of libVersionRanges) {
      const pairKey = `${task.preVersion}_${task.postVersion}`;
      const pairClients = pairClientMap.get(pairKey);

      if (!pairClients) {
        appendCloneLog([invalidCloneLogPath], task.libName, task.preVersion, task.postVersion, 0, 0, 'EXCLUDED_NOT_ENOUGH_DATA', 0);
        continue;
      }

      console.log(`\n--- Task: ${task.libName} (${task.preVersion} -> ${task.postVersion}) ---`);
      const taskStartTime = Date.now();

      // マスターデータから該当クライアントを分配
      const historySucc = masterHistory.filter(c => pairClients.succ.includes(c.C_client));
      const historyFail = masterHistory.filter(c => pairClients.fail.includes(c.C_client));
      const taskDuration = (Date.now() - taskStartTime) / 1000;

      if (historySucc.length > 0 && historyFail.length > 0) {
        await saveAndAnalyzeData(task, 'success', dateStr, CONFIG.mode, historySucc);
        await saveAndAnalyzeData(task, 'failure', dateStr, CONFIG.mode, historyFail);
        appendCloneLog([validCloneLogPath], task.libName, task.preVersion, task.postVersion, historySucc.length, historyFail.length, 'SUCCESS', taskDuration);
      } else {
        console.log(`  [Exclude] One of the states returned 0 valid histories from master.`);
        appendCloneLog([invalidCloneLogPath], task.libName, task.preVersion, task.postVersion, historySucc.length, historyFail.length, 'EXCLUDED_ZERO_MATCH', taskDuration);
      }
    }
  }

  // ---------------------------------------------------------
  // [パターン B] analyze モードのみ
  // ---------------------------------------------------------
  else if (CONFIG.mode === 'analyze') {
    const targetPath = CONFIG.analyzeTargetHistoryPath;
    
    // CONFIGで指定した値を確実に使う
    const task = { 
      libName: CONFIG.analyzeLibName, 
      preVersion: "unknown", 
      postVersion: CONFIG.analyzePostVersion 
    };
    
    console.log(`[Analyze Mode] Target Task: ${task.libName} (-> ${task.postVersion})`);

    await saveAndAnalyzeData(task, CONFIG.analyzeState, dateStr, CONFIG.mode, [], targetPath);
  }
})();