import fs from "fs";
import path from "path";
import { Item } from "../types/Item";
import { VersionPair } from "../types/VersionPair";

// utils・core はすべてオブジェクトとしてインポート
import loadJson from "../utils/loadJson";
import extractVersion from "../core/extractVersion";
import createVersionPairs from "../core/create_version_pairs";
import outputJson from "../utils/output_json";
import dataProcessor from "../utils/dataProcessor";
import targetCommits from "../analysis/targetCommits";
import versionUtil from "../analysis/versionUtil";

type RunMode = 'extract' | 'analyze' | 'full';

// INPUT: 実行設定
const CONFIG = {
  // 実行モードの指定
  mode: 'full' as RunMode,

  // 全体的な出力のベースディレクトリ
  outputBaseDir: '../../output/0421_old/',
  // テスト結果データセットのパス
  testResultPath: '../../datasets/test_result.json',

  // 抽出対象とするライブラリの指定 (例: 'uuid')
  // 空文字 '' に設定すると、データセット内の全ライブラリを対象に実行する
  targetLibrary: '',

  // [analyze モード専用設定]
  analyzeTargetHistoryPath: '../../output/versionData/2026-03-01-12-00-00/success/libname/version_history-success-14total.json',
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
      const targets = targetCommits.get(verHistory, libName, postVersion);
      const inputList: string[][] = [];

      for (const t of targets) {
        const normPre = versionUtil.normalize(t.L_preLibVersion);
        const normPost = versionUtil.normalize(t.L_postLibVersion);
        inputList.push([normPre, normPost]);
      }

      // ペアの集計
      const pairs = createVersionPairs.create_version_pairs(inputList, libName, 1);

      outputJson.createDir(outputDir);

      // result_pairs の保存
      const pairPath = outputJson.getUniquePath(outputDir, `result_pairs-${state}`, `${population}total`);
      fs.writeFileSync(pairPath, JSON.stringify(pairs, null, 2));

      // 種別ごとの分類と保存
      classifyTypes(pairs, libName, postVersion, dateStr, state, population);
      console.log(`  [Analyze] Classification completed for ${state}.`);
    } else {
      console.log(`  [Analyze] No history data to analyze for ${state}.`);
    }
  }
}

/**
 * 種別ごとにデータを分類して保存
 */
function classifyTypes(data: VersionPair[], libName: string, postLibVersion: string, dateStr: string, state: string, population: number): void {
  data = [...data].sort((a, b) => b.count - a.count);
  let outDir = path.join(`${CONFIG.outputBaseDir}/sortData`, dateStr, state, `${libName}-${postLibVersion}`);
  outputJson.createDir(outDir);

  const types: ('update' | 'downgrade' | 'same')[] = ['update', 'downgrade', 'same'];
  types.forEach(type => {
    const filteredData = data.filter((item) => item.type === type);
    const typeCount = filteredData.reduce((sum, p) => sum + p.count, 0);
    const countSuffix = `_${typeCount}${type}-${population}total`;

    const outputPath = outputJson.getUniquePath(outDir, '', countSuffix);
    fs.writeFileSync(outputPath, JSON.stringify(filteredData, null, 2));
  });
}

/**
 * 実行結果をCSVに追記 (Durationの引数を削除)
 */
function appendCloneLog(logPaths: string[], libName: string, preVer: string, postVer: string, succCount: number, failCount: number, status: string) {
  const logLine = `${libName},${preVer},${postVer},${succCount},${failCount},${status}\n`;
  for (const logPath of logPaths) {
    fs.appendFileSync(logPath, logLine, 'utf8');
  }
}

(async () => {
  const dateStr = outputJson.formatDateTime(new Date());

  console.log(`\n==================================================`);
  console.log(`[Run Mode] ${CONFIG.mode.toUpperCase()}`);
  console.log(`==================================================`);

  if (CONFIG.mode === 'full' || CONFIG.mode === 'extract') {
    const cloneResultDir = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/cloneResult/${dateStr}`);
    const versionDataRoot = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/versionData/${dateStr}`);
    const allVerHistDir = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/allverHist/${dateStr}`); // 追加: 全履歴保存用

    outputJson.createDir(cloneResultDir);
    outputJson.createDir(versionDataRoot);
    outputJson.createDir(allVerHistDir); // ディレクトリ作成

    const validCloneLogPath = path.join(cloneResultDir, 'valid_clone_summary.csv');
    const invalidCloneLogPath = path.join(cloneResultDir, 'invalid_clone_summary.csv');
    const validVerDataLogPath = path.join(versionDataRoot, 'valid_clone_summary.csv');
    const invalidVerDataLogPath = path.join(versionDataRoot, 'invalid_clone_summary.csv');

    // ヘッダーから Duration(s) を削除
    const csvHeader = 'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status\n';

    fs.writeFileSync(validCloneLogPath, csvHeader, 'utf8');
    fs.writeFileSync(invalidCloneLogPath, csvHeader, 'utf8');
    fs.writeFileSync(validVerDataLogPath, csvHeader, 'utf8');
    fs.writeFileSync(invalidVerDataLogPath, csvHeader, 'utf8');

    console.log(`[Init] Loading dataset: ${CONFIG.testResultPath}`);
    const data: Item[] = await loadJson.item(CONFIG.testResultPath);

    let libVersionRanges = dataProcessor.extractUpdateTasks(data);
    console.log(`[Init] Extracted ${libVersionRanges.length} total valid version pairs from dataset.`);

    if (CONFIG.targetLibrary) {
      libVersionRanges = libVersionRanges.filter(task => task.libName.includes(CONFIG.targetLibrary));
      console.log(`[Init] Filtered by targetLibrary '${CONFIG.targetLibrary}'. Processing ${libVersionRanges.length} pairs.`);
    }

    if (libVersionRanges.length === 0) return;

    const matchLib = (item: Item, targetLib: string) =>
      (item.L__npm_pkg && item.L__npm_pkg === targetLib) || item.L__nameWithOwner.includes(targetLib);

    const tasksByLib = new Map<string, any[]>();
    for (const task of libVersionRanges) {
      if (!tasksByLib.has(task.libName)) tasksByLib.set(task.libName, []);
      tasksByLib.get(task.libName)!.push(task);
    }

    // ライブラリごとに抽出・解析処理を実行
    for (const [libName, tasks] of tasksByLib.entries()) {
      const masterClientSet = new Set<string>();
      const pairClientMap = new Map<string, { succ: string[], fail: string[] }>();

      // このライブラリに属する全タスクのクライアントを収集
      for (const task of tasks) {
        const { preVersion, postVersion } = task;

        const list1 = data.filter(item => matchLib(item, libName) && item.L__version === preVersion && item.state === "success").map(item => item.S__nameWithOwner);
        const list2Succ = data.filter(item => matchLib(item, libName) && item.L__version === postVersion && item.state === "success").map(item => item.S__nameWithOwner);
        const list2Fail = data.filter(item => matchLib(item, libName) && item.L__version === postVersion && item.state === "failure").map(item => item.S__nameWithOwner);

        const clientsSucc = [...new Set(list2Succ.filter(value => list1.includes(value)))];
        const clientsFail = [...new Set(list2Fail.filter(value => list1.includes(value)))];

        if (clientsSucc.length > 0 && clientsFail.length > 0) {
          clientsSucc.forEach(c => masterClientSet.add(c));
          clientsFail.forEach(c => masterClientSet.add(c));
          pairClientMap.set(`${preVersion}_${postVersion}`, { succ: clientsSucc, fail: clientsFail });
        }
      }

      const allClients = Array.from(masterClientSet);
      if (allClients.length === 0) {
        for (const task of tasks) {
          appendCloneLog([invalidCloneLogPath, invalidVerDataLogPath], task.libName, task.preVersion, task.postVersion, 0, 0, 'EXCLUDED_NOT_ENOUGH_DATA');
        }
        continue;
      }

      console.log(`\n[Master Extract] Starting extraction for ${libName} (${allClients.length} unique clients)...`);

      const masterHistory = await extractVersion.extractVersion_master(allClients, libName);

      if (masterHistory.length > 0) {
        // スラッシュ等が含まれている場合を考慮し、ファイル名として安全な形式にする
        const safeLibName = libName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const allHistPath = path.join(allVerHistDir, `${safeLibName}_all_history.json`);
        fs.writeFileSync(allHistPath, JSON.stringify(masterHistory, null, 2));
        console.log(`[Master Extract] Saved full history for ${libName} to ${allHistPath}`);
      }

      // 取得した履歴をタスク（バージョンペア）ごとに分配して解析・保存
      for (const task of tasks) {
        const pairKey = `${task.preVersion}_${task.postVersion}`;
        const pairClients = pairClientMap.get(pairKey);

        if (!pairClients) {
          appendCloneLog([invalidCloneLogPath, invalidVerDataLogPath], task.libName, task.preVersion, task.postVersion, 0, 0, 'EXCLUDED_NOT_ENOUGH_DATA');
          continue;
        }

        console.log(`--- Task: ${task.libName} (${task.preVersion} -> ${task.postVersion}) ---`);

        const historySucc = masterHistory.filter(c => pairClients.succ.includes(c.C_client));
        const historyFail = masterHistory.filter(c => pairClients.fail.includes(c.C_client));

        if (historySucc.length > 0 && historyFail.length > 0) {
          await saveAndAnalyzeData(task, 'success', dateStr, CONFIG.mode, historySucc);
          await saveAndAnalyzeData(task, 'failure', dateStr, CONFIG.mode, historyFail);

          appendCloneLog([validCloneLogPath, validVerDataLogPath], task.libName, task.preVersion, task.postVersion, historySucc.length, historyFail.length, 'SUCCESS');
        } else {
          console.log(`  [Exclude] One of the states returned 0 valid histories from master.`);
          appendCloneLog([invalidCloneLogPath, invalidVerDataLogPath], task.libName, task.preVersion, task.postVersion, historySucc.length, historyFail.length, 'EXCLUDED_ZERO_MATCH');
        }
      }
    }
  } else if (CONFIG.mode === 'analyze') {   // [パターン B] analyze モードのみ
    const targetPath = CONFIG.analyzeTargetHistoryPath;
    const task = {
      libName: CONFIG.analyzeLibName,
      preVersion: "unknown",
      postVersion: CONFIG.analyzePostVersion
    };

    console.log(`[Analyze Mode] Target Task: ${task.libName} (-> ${task.postVersion})`);
    await saveAndAnalyzeData(task, CONFIG.analyzeState, dateStr, CONFIG.mode, [], targetPath);
  }
})();