// 依存ライブラリのバージョン更新に伴うクライアントの履歴抽出・分析スクリプト
// 【入力】
// - CONFIG.testResultPath (必須): 全クライアントのテスト結果データ (test_result.json)
// - CONFIG.myDataPath (任意): 分析対象のライブラリ名とバージョンペアを指定したJSON
//   ※myDataPathが存在しない場合はtestResultPathから全件自動抽出(fullモード)として動作します

import fs from "fs";
import path from "path";
import { Item } from "./types/Item";
import { VersionPair } from "./types/VersionPair";

import LoadJson from "./utils/loadJson";
import ExtractVersion from "./core/extractVersion";
import CreateVersionPairs from "./core/create_version_pairs"; 
import OutputJson from "./utils/output_json";
import dataProcessor from "./utils/dataProcessor";
import TargetCommits from "./analysis/targetCommits";
import VersionUtil from "./analysis/versionUtil";
import { getReleaseHistory } from "./git/getReleaseHistory";
import { trackPostUpdate } from "./analysis/postUpdateTracker";

type RunMode = 'extract' | 'analyze' | 'full';

// CSV出力用の型定義
interface TrackingSummary {
  libName: string;
  preVersion: string;
  postVersion: string;
  state: string;
  originalClients: number;
  targetUpdatedClients: number;
  maintained: number;
  upgradedFurther: number;
  totalDowngrades: number;
  downgradeR1: number;
  downgradeR2: number;
  downgradeR3: number;
  noReleaseCount: number;
}

// INPUT: 実行設定
const CONFIG = {
  // --- 基本動作設定 ---
  // 実行モード: 'extract' (抽出のみ), 'analyze' (解析のみ), 'full' (抽出から解析まで全自動)
  mode: 'full' as RunMode,

  // --- 入出力パス設定 ---
  // 分析対象のタスク（ライブラリ名と更新前/後のバージョン）を指定するリストのパス
  // ※ファイルが存在しない場合は、テスト結果から有効なペアを全件自動抽出します
  // myDataPath: '../datasets/mydata/mydata.json',
  myDataPath: '',
  
  // 抽出した履歴データやクローン結果、集計CSVを出力するルートディレクトリ
  outputBaseDir: '../output/v2',
  
  // クライアント一覧を特定するために読み込む、元となるテスト結果データセットのパス
  testResultPath: '../datasets/test_result.json',
  
  // --- フィルタリング設定 (full / extract モード用) ---
  // 文字列を指定(例: 'uuid')すると、全件抽出時でもそのライブラリに関する処理だけに絞り込みます
  // 空文字 '' の場合は絞り込みを行いません
  targetLibrary: '', 

  // --- 手動解析設定 (analyze モード専用) ---
  analyzeTargetHistoryPath: '../output/versionData/2026-03-01-12-00-00/success/libname/version_history-success-14total.json',
  analyzeState: 'failure',
  analyzeLibName: 'Brightspace',
  analyzePostVersion: '3.1.0'
};
/**
 * データの保存と解析（分類）を行う補助関数
 * 集計データを戻り値として返し、最終的なCSV作成に利用する
 */
async function saveAndAnalyzeData(libTask: any, state: string, dateStr: string, mode: RunMode, verHistory: any[] = [], targetPath: string = ""): Promise<TrackingSummary | null> {
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
      if (fs.existsSync(targetPath)) {
        verHistory = await LoadJson.clientVer(targetPath);
      } else {
        console.error(`  [Error] analyzeTargetHistoryPath does not exist.`);
        return null;
      }
    }

    population = verHistory.length;
    let summary: TrackingSummary = {
      libName, preVersion, postVersion, state,
      originalClients: population, targetUpdatedClients: 0,
      maintained: 0, upgradedFurther: 0, totalDowngrades: 0,
      downgradeR1: 0, downgradeR2: 0, downgradeR3: 0, noReleaseCount: 0
    };

    if (population > 0) {
      const targets = TargetCommits.get(verHistory, libName, postVersion);
      summary.targetUpdatedClients = targets.length;

      const postUpdateTracking = trackPostUpdate(targets, verHistory, postVersion);
      OutputJson.createDir(outputDir);
      const trackingPath = OutputJson.getUniquePath(outputDir, `post_update_tracking-${state}`, `${population}total`);
      fs.writeFileSync(trackingPath, JSON.stringify(postUpdateTracking, null, 2));
      console.log(`  [Analyze] Post-update tracking saved to ${trackingPath}`);

      // CSV出力用にトラッキング結果を集計する
      const isDowngrade = (rel: any) => rel && rel.libVersionAtRelease && rel.libVersionAtRelease.includes('Downgraded');
      
      for (const track of postUpdateTracking) {
        if (track.finalStatus === 'downgraded_eventually') summary.totalDowngrades++;
        else if (track.finalStatus === 'upgraded_eventually') summary.upgradedFurther++;
        else if (track.finalStatus === 'maintained') summary.maintained++;
        else if (track.finalStatus === 'no_release') summary.noReleaseCount++;

        if (isDowngrade(track.releases[0])) summary.downgradeR1++;
        if (isDowngrade(track.releases[1])) summary.downgradeR2++;
        if (isDowngrade(track.releases[2])) summary.downgradeR3++;
      }

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
      
      return summary;
    } else {
      console.log(`  [Analyze] No history data to analyze for ${state}.`);
      return summary;
    }
  }
  return null;
}

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

function appendCloneLog(logPaths: string[], libName: string, preVer: string, postVer: string, succCount: number, failCount: number, status: string) {
  const logLine = `${libName},${preVer},${postVer},${succCount},${failCount},${status}\n`;
  for (const logPath of logPaths) {
    fs.appendFileSync(logPath, logLine, 'utf8');
  }
}

(async () => {
  let dateStr = OutputJson.formatDateTime(new Date());
  let libVersionRanges: { libName: string; preVersion: string; postVersion: string }[] = [];
  let suffix = "";

  console.log(`\n==================================================`);
  console.log(`[Run Mode] ${CONFIG.mode.toUpperCase()}`);
  console.log(`==================================================`);

  if (CONFIG.mode === 'full' || CONFIG.mode === 'extract') {
    
    if (fs.existsSync(CONFIG.myDataPath)) {
      console.log(`[Init] mydata.json found. Running in target mode.`);
      libVersionRanges = JSON.parse(fs.readFileSync(CONFIG.myDataPath, 'utf-8')) as { libName: string; preVersion: string; postVersion: string }[];
      suffix = `-${libVersionRanges.length}`;
    } else {
      console.log(`[Init] mydata.json NOT found. Extracting all valid pairs from testResult (Full Mode).`);
      suffix = '-full';
    }

    dateStr += suffix;

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

    console.log(`[Init] Loading dataset: ${CONFIG.testResultPath}`);
    const data: Item[] = await LoadJson.item(CONFIG.testResultPath);

    if (suffix === '-full') {
      libVersionRanges = dataProcessor.extractUpdateTasks(data);
      console.log(`[Init] Extracted ${libVersionRanges.length} total valid version pairs from dataset.`);

      if (CONFIG.targetLibrary) {
        libVersionRanges = libVersionRanges.filter(task => task.libName.includes(CONFIG.targetLibrary));
        console.log(`[Init] Filtered by targetLibrary '${CONFIG.targetLibrary}'. Processing ${libVersionRanges.length} pairs.`);
      }
    }

    if (libVersionRanges.length === 0) return;

    const matchLib = (item: Item, targetLib: string) =>
      (item.L__npm_pkg && item.L__npm_pkg === targetLib) || item.L__nameWithOwner.includes(targetLib);

    const tasksByLib = new Map<string, any[]>();

    //LOOK:mydata,デバッグ用_vinyl (1.2.0 -> 2.0.0)
    let tasks = [libVersionRanges[7]];
    // for (const task of tasks) {
    //   if (task) {
    //     console.log(`Loaded task: ${task.libName} (${task.preVersion} -> ${task.postVersion})`);
    //     if (!tasksByLib.has(task.libName)) tasksByLib.set(task.libName, []);
    //     tasksByLib.get(task.libName)!.push(task);
    //   }
    // }

    // //LOOK:本番用
    for (const task of libVersionRanges) {
      console.log(`Loaded task: ${task.libName} (${task.preVersion} -> ${task.postVersion})`);
      if (!tasksByLib.has(task.libName)) tasksByLib.set(task.libName, []);
      tasksByLib.get(task.libName)!.push(task);
    }

    // 全ての処理結果をまとめる配列
    const masterTrackingSummaries: TrackingSummary[] = [];

    for (const [libName, tasks] of tasksByLib.entries()) {
      const masterClientSet = new Set<string>();
      const pairClientMap = new Map<string, { succ: string[], fail: string[] }>();

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
      const rawMasterHistory = await ExtractVersion.extractVersion_master(allClients, libName);

      const masterHistory = rawMasterHistory.map(clientData => {
        const repoPath = path.resolve(process.cwd(), `../clonedata/temp/master/${libName}/${clientData.C_client}`);
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
          const succSummary = await saveAndAnalyzeData(task, 'success', dateStr, CONFIG.mode, historySucc);
          const failSummary = await saveAndAnalyzeData(task, 'failure', dateStr, CONFIG.mode, historyFail);
          
          if (succSummary) masterTrackingSummaries.push(succSummary);
          if (failSummary) masterTrackingSummaries.push(failSummary);

          appendCloneLog([validCloneLogPath, validVerDataLogPath], task.libName, task.preVersion, task.postVersion, historySucc.length, historyFail.length, 'SUCCESS');
        } else {
          appendCloneLog([invalidCloneLogPath, invalidVerDataLogPath], task.libName, task.preVersion, task.postVersion, historySucc.length, historyFail.length, 'EXCLUDED_ZERO_MATCH');
        }
      }
    }

    // すべての処理が完了した後、versionDataフォルダの最上層に集計CSVを生成する
    if (masterTrackingSummaries.length > 0) {
      const trackingCsvPath = path.join(versionDataRoot, 'aggregate_tracking_summary.csv');
      const trackHeader = "Library,PreVersion,PostVersion,State,OriginalClients,TargetUpdatedClients,Maintained,UpgradedFurther,TotalDowngrades,Downgrade_R1,Downgrade_R2,Downgrade_R3,NoReleaseCount\n";
      const trackRows = masterTrackingSummaries.map(s => 
        `${s.libName},${s.preVersion},${s.postVersion},${s.state},${s.originalClients},${s.targetUpdatedClients},${s.maintained},${s.upgradedFurther},${s.totalDowngrades},${s.downgradeR1},${s.downgradeR2},${s.downgradeR3},${s.noReleaseCount}`
      ).join('\n');
      
      fs.writeFileSync(trackingCsvPath, trackHeader + trackRows, 'utf8');
      console.log(`\n[Done] Aggregate Tracking Summary CSV generated at: ${trackingCsvPath}`);
    }

  } else if (CONFIG.mode === 'analyze') {
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