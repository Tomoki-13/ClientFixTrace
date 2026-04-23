import fs from "fs";
import path from "path";
import { Item } from "./types/Item";
import { VersionPair } from "./types/VersionPair";

import LoadJson from "./utils/loadJson";
import ExtractVersion from "./core/extractVersion";
import CreateVersionPairs from "./core/create_version_pairs";
import OutputJson from "./utils/output_json";
import TargetCommits from "./utils/targetCommits";
import VersionUtil from "./utils/versionUtil";
import { getReleaseHistory } from "./git/getReleaseHistory";

type RunMode = 'extract' | 'analyze' | 'full';

const CONFIG = {
  mode: 'full' as RunMode,
  myDataPath: '../datasets/mydata/mydata.json',
  outputBaseDir: '../output/v2/',
  testResultPath: '../datasets/test_result.json',
  // testResultPath: '../datasets/sample.json',
  analyzeTargetHistoryPath: '../output/versionData/2026-03-01-12-00-00/success/libname/version_history-success-100total.json'
};

/**
 * [入出力説明]
 * 入力:
 * - libTask (any): libName, preVersion, postVersionを含むタスクオブジェクト
 * - state (string): 'success' または 'failure'
 * - dateStr (string): 出力パス用フォーマット済み日時文字列
 * - mode (RunMode): 実行モード
 * - verHistory (any[]): クライアントのバージョン履歴データ
 * - targetPath (string): analyzeモード時に読み込むJSONパス
 * 出力:
 * - Promise<void>: 結果をJSON形式でファイル出力し終了する
 */

// 直近の3件のリリース履歴を取得するロジックを追加
async function saveAndAnalyzeData(libTask: any, state: string, dateStr: string, mode: RunMode, verHistory: any[] = [], targetPath: string = "") {
  const { libName, preVersion, postVersion } = libTask;
  const outputDir = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/versionData/${dateStr}/${state}/${libName}-${postVersion}`);
  let population = 0;

  if ((mode === 'extract' || mode === 'full') && verHistory.length > 0) {
    population = verHistory.length;
    OutputJson.createDir(outputDir);
    const historyPath = OutputJson.getUniquePath(outputDir, `version_history-${state}`, `${population}total`);
    fs.writeFileSync(historyPath, JSON.stringify(verHistory, null, 2));
    console.log(`  [Extract] Saved ${population} histories for ${state}.`);
  }

  if (mode === 'analyze' || mode === 'full') {
    if (mode === 'analyze' && targetPath.length > 0) {
      console.log(`  [Analyze] Loading existing file: ${targetPath}`);
      verHistory = await LoadJson.clientVer(targetPath);
    }

    population = verHistory.length;

    if (population > 0) {
      const targets = TargetCommits.get(verHistory, libName, postVersion);
      const inputList: string[][] = [];

      for (const t of targets) {
        const normPre = VersionUtil.normalize(t.L_preLibVersion);
        const normPost = VersionUtil.normalize(t.L_postLibVersion);
        inputList.push([normPre, normPost]);
      }

      const pairs = CreateVersionPairs.create_version_pairs(inputList, libName, 1);

      OutputJson.createDir(outputDir);
      const updateCount = pairs.filter(p => p.type === 'update').reduce((sum, p) => sum + p.count, 0);
      const countSuffix = `${updateCount}updated-${population}total`;

      const pairPath = OutputJson.getUniquePath(outputDir, `result_pairs-${state}`, countSuffix);
      fs.writeFileSync(pairPath, JSON.stringify(pairs, null, 2));

      Classify_types(pairs, libName, postVersion, dateStr, state, countSuffix);
      console.log(`  [Analyze] Classification completed for ${state}: ${countSuffix}`);
    } else {
      console.log(`  [Analyze] No history data to analyze for ${state}.`);
    }
  }
}

/**
 * [入出力説明]
 * 入力:
 * - data (VersionPair[]): バージョン遷移のペア配列
 * - libName (string): ライブラリ名
 * - postLibVersion (string): 更新後のバージョン
 * - dateStr (string): フォーマット済み日時
 * - state (string): 'success' または 'failure'
 * - countSuffix (string): 出力ファイル名用サフィックス
 * 出力:
 * - void: 'update', 'downgrade', 'same' の種類ごとにJSONファイルとして保存する
 */
function Classify_types(data: VersionPair[], libName: string, postLibVersion: string, dateStr: string, state: string, countSuffix: string): void {
  data = [...data].sort((a, b) => b.count - a.count);
  let outDir = path.join(`${CONFIG.outputBaseDir}/sortData`, dateStr, state, `${libName}-${postLibVersion}`);
  OutputJson.createDir(outDir);

  const types: ('update' | 'downgrade' | 'same')[] = ['update', 'downgrade', 'same'];
  types.forEach(type => {
    const filteredData = data.filter((item) => item.type === type);
    const outputPath = OutputJson.getUniquePath(outDir, '', `${type}_${countSuffix}`);
    fs.writeFileSync(outputPath, JSON.stringify(filteredData, null, 2));
  });
}

/**
 * [入出力説明]
 * 入力:
 * - logPaths (string[]): 出力先CSVパスの配列
 * - libName, preVer, postVer (string): ライブラリ情報
 * - succCount, failCount (number): クローン成功/失敗数
 * - status (string): 抽出ステータス
 * 出力:
 * - void: 各ファイルにCSV行を追記する
 */
function appendCloneLog(logPaths: string[], libName: string, preVer: string, postVer: string, succCount: number, failCount: number, status: string) {
  const logLine = `${libName},${preVer},${postVer},${succCount},${failCount},${status}\n`;
  for (const logPath of logPaths) {
    fs.appendFileSync(logPath, logLine, 'utf8');
  }
}

(async () => {
  const dateStr = OutputJson.formatDateTime(new Date());

  if (CONFIG.mode === 'full' || CONFIG.mode === 'extract') {
    const cloneResultDir = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/cloneResult/${dateStr}`);
    const versionDataRoot = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/versionData/${dateStr}`);
    const allVerHistDir = path.resolve(process.cwd(), `${CONFIG.outputBaseDir}/allverHist/${dateStr}`);

    OutputJson.createDir(cloneResultDir);
    OutputJson.createDir(versionDataRoot);
    OutputJson.createDir(allVerHistDir);

    const validCloneLogPath = path.join(cloneResultDir, 'valid_clone_summary.csv');
    const invalidCloneLogPath = path.join(cloneResultDir, 'invalid_clone_summary.csv');
    const validVerDataLogPath = path.join(versionDataRoot, 'valid_clone_summary.csv');
    const invalidVerDataLogPath = path.join(versionDataRoot, 'invalid_clone_summary.csv');

    const csvHeader = 'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status\n';

    fs.writeFileSync(validCloneLogPath, csvHeader, 'utf8');
    fs.writeFileSync(invalidCloneLogPath, csvHeader, 'utf8');
    fs.writeFileSync(validVerDataLogPath, csvHeader, 'utf8');
    fs.writeFileSync(invalidVerDataLogPath, csvHeader, 'utf8');

    console.log(`[Init] Loading datasets...`);
    const data: Item[] = await LoadJson.item(CONFIG.testResultPath);

    const libVersionRanges = JSON.parse(fs.readFileSync(CONFIG.myDataPath, 'utf-8')) as { libName: string; preVersion: string; postVersion: string }[];

    const tasksByLib = new Map<string, any[]>();
    //LOOK:デバッグ用_vinyl (1.2.0 -> 2.0.0)
    let tasks = [libVersionRanges[7]];
    for (const task of tasks) {
      console.log(`Loaded task: ${task.libName} (${task.preVersion} -> ${task.postVersion})`);
      if (!tasksByLib.has(task.libName)) tasksByLib.set(task.libName, []);
      tasksByLib.get(task.libName)!.push(task);
    }

    //LOOK:本番用
    // for (const task of libVersionRanges) {
    //   console.log(`Loaded task: ${task.libName} (${task.preVersion} -> ${task.postVersion})`);
    //   if (!tasksByLib.has(task.libName)) tasksByLib.set(task.libName, []);
    //   tasksByLib.get(task.libName)!.push(task);
    // }

    for (const [libName, tasks] of tasksByLib.entries()) {
      const masterClientSet = new Set<string>();
      const pairClientMap = new Map<string, { succ: string[], fail: string[] }>();

      for (const task of tasks) {
        const { preVersion, postVersion } = task;

        const list1 = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version === preVersion && item.state === "success").map(item => item.S__nameWithOwner);
        const list2Succ = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version === postVersion && item.state === "success").map(item => item.S__nameWithOwner);
        const list2Fail = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version === postVersion && item.state === "failure").map(item => item.S__nameWithOwner);

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
      const rawMasterHistory = await ExtractVersion.extractVersion_master(allClients, libName);

      const masterHistory = rawMasterHistory.map(clientData => {
        const repoPath = path.resolve(process.cwd(), `../../clonedata/temp/master/${libName}/${clientData.C_client}`);
        const enrichedVerList = clientData.verList.map(v => {
          const releases = getReleaseHistory(repoPath, libName, v.C_commitID);
          return { ...v, C_releases: releases };
        });
        return { ...clientData, verList: enrichedVerList };
      });

      if (masterHistory.length > 0) {
        const safeLibName = libName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const allHistPath = path.join(allVerHistDir, `${safeLibName}_all_history.json`);
        fs.writeFileSync(allHistPath, JSON.stringify(masterHistory, null, 2));
      }

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
          appendCloneLog([invalidCloneLogPath, invalidVerDataLogPath], task.libName, task.preVersion, task.postVersion, historySucc.length, historyFail.length, 'EXCLUDED_ZERO_MATCH');
        }
      }
    }
  } else if (CONFIG.mode === 'analyze') {
    const targetPath = CONFIG.analyzeTargetHistoryPath;
    const dummyTask = { libName: "Brightspace", preVersion: "unknown", postVersion: "3.1.0" };
    await saveAndAnalyzeData(dummyTask, 'failure', dateStr, CONFIG.mode, [], targetPath);
  }
})();
