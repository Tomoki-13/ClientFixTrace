import fs from "fs";
import path from "path";
import { Item } from "./types/Item";

import LoadJson from "./utils/loadJson";
import ExtractVersion from "./core/extractVersion";
import OutputJson from "./utils/output_json";
import dataProcessor from "./utils/dataProcessor";
import WorkspaceManager from "./utils/workspaceManager";
import { getReleaseHistory } from "./git/getReleaseHistory";

import {
  type InternalRunMode,
  type TrackingSummary,
  verHistBase,
  initSummaryCsvs,
  appendCloneLog,
  saveAndAnalyzeData,
  saveAllHistory,
  writeAggregateCsv,
} from "./utils/verHistLayout";

// RUN_ID: Meta Makefile の BCPG_RUN_ID を優先、無ければ生成
// 出力 history/verHist/<mode>/<RUN_ID>/ → Makefile が latest/verHist/<mode>/ にコピー
const RUN_ID: string = process.env.BCPG_RUN_ID ?? OutputJson.formatDateTime(new Date());

// ===== INPUT: 実行設定（パスはメタリポ配下を参照 / 単体実行は非対応＝README） =====
const CONFIG = {
  /** CLI 引数が無いときに使うモード */
  DEFAULT_MODE: 'full' as 'full' | 'partial',

  /** [入力] 共通: テスト結果データセット */
  testResultPath: '../../datasets/test_result.json',

  // ===== Full モード =====
  FULL: {
    /** [入力] 空文字=test_result.json から全件自動抽出 / JSON パス指定=それを使用 */
    myDataPath: '',
    /** [入力] 特定ライブラリのみに絞る (空文字=全件) */
    targetLibrary: '',
    runMode: 'full' as InternalRunMode,

    /** DEBUG_TARGETS のみを高速処理（挙動検証用） */
    DEBUG_MODE: false,
    DEBUG_TARGETS: [
      { libName: 'acorn', preVersion: '4.0.2', postVersion: '4.0.3' },
      { libName: 'acorn', preVersion: '4.0.4', postVersion: '4.0.5' },
      { libName: 'acorn', preVersion: '5.3.0', postVersion: '5.4.0' }
    ],

    // analyze モード専用 (runMode='analyze' のときのみ)
    analyzeTargetHistoryPath: '',
    analyzeState: 'failure',
    analyzeLibName: '',
    analyzePostVersion: ''
  },

  // ===== Partial モード =====
  PARTIAL: {
    /** [入力] 処理対象ペア (Partial では必須) */
    myDataPath: '../../datasets/targets.json',
    runMode: 'full' as InternalRunMode,
  }
};

// CLI引数 or CONFIG.DEFAULT_MODE でモードを決定
const MODE = (['full', 'partial'].includes(process.argv[2])
  ? process.argv[2]
  : CONFIG.DEFAULT_MODE) as 'full' | 'partial';

// Full と同じ照合ロジック (L__npm_pkg 優先 + L__nameWithOwner フォールバック)
const matchLib = (item: Item, libName: string) =>
  (item.L__npm_pkg && item.L__npm_pkg === libName) || item.L__nameWithOwner.includes(libName);

// ==========================================
// Full モード
// ==========================================

async function runFullMode(): Promise<void> {
  const C = CONFIG.FULL;
  const base = verHistBase('full', RUN_ID);
  let libVersionRanges: { libName: string; preVersion: string; postVersion: string }[] = [];

  console.log(`\n==================================================`);
  console.log(`[Mode] FULL${C.DEBUG_MODE ? ' (DEBUG MODE)' : ''}`);
  console.log(`==================================================`);

  if (C.runMode !== 'full' && C.runMode !== 'extract') {
    // analyze モード専用
    await saveAndAnalyzeData(
      { libName: C.analyzeLibName, preVersion: 'unknown', postVersion: C.analyzePostVersion },
      C.analyzeState, C.runMode, base, [], C.analyzeTargetHistoryPath
    );
    return;
  }

  const { validCloneLogPath, invalidCloneLogPath } = initSummaryCsvs(base);

  console.log(`[Init] Loading dataset: ${CONFIG.testResultPath}`);
  const data: Item[] = await LoadJson.item(CONFIG.testResultPath);

  // タスクリストの決定
  if (C.DEBUG_MODE) {
    libVersionRanges = C.DEBUG_TARGETS;
    console.log(`[Init] Debug mode: ${libVersionRanges.length} specific tasks.`);
  } else if (C.myDataPath && fs.existsSync(C.myDataPath)) {
    libVersionRanges = JSON.parse(fs.readFileSync(C.myDataPath, 'utf-8'));
    console.log(`[Init] mydata.json found. Loaded ${libVersionRanges.length} pairs.`);
  } else {
    libVersionRanges = dataProcessor.extractUpdateTasks(data);
    if (C.targetLibrary) {
      libVersionRanges = libVersionRanges.filter(t => t.libName.includes(C.targetLibrary));
      console.log(`[Init] Filtered by '${C.targetLibrary}'. ${libVersionRanges.length} pairs.`);
    } else {
      console.log(`[Init] Full mode. Extracted ${libVersionRanges.length} pairs.`);
    }
  }
  if (libVersionRanges.length === 0) return;

  const tasksByLib = new Map<string, any[]>();
  for (const task of libVersionRanges) {
    if (!tasksByLib.has(task.libName)) tasksByLib.set(task.libName, []);
    tasksByLib.get(task.libName)!.push(task);
  }

  const masterTrackingSummaries: TrackingSummary[] = [];

  for (const [libName, tasks] of tasksByLib.entries()) {
    const masterClientSet = new Set<string>();
    const pairClientMap = new Map<string, { succ: string[]; fail: string[] }>();

    for (const task of tasks) {
      const { preVersion, postVersion } = task;
      const list1     = data.filter(i => matchLib(i, libName) && i.L__version === preVersion  && i.state === 'success').map(i => i.S__nameWithOwner);
      const list2Succ = data.filter(i => matchLib(i, libName) && i.L__version === postVersion && i.state === 'success').map(i => i.S__nameWithOwner);
      const list2Fail = data.filter(i => matchLib(i, libName) && i.L__version === postVersion && i.state === 'failure').map(i => i.S__nameWithOwner);

      const clientsSucc = [...new Set(list2Succ.filter(v => list1.includes(v)))];
      const clientsFail = [...new Set(list2Fail.filter(v => list1.includes(v)))];

      // BC Loss Filter: Failure が 0 件なら除外
      if (clientsFail.length === 0) {
        if (C.DEBUG_MODE) {
          console.log(`  -> EXCLUDED: 0 Failure clients for ${libName} (${preVersion} -> ${postVersion})`);
        }
        appendCloneLog(
          [invalidCloneLogPath],
          task.libName, task.preVersion, task.postVersion,
          clientsSucc.length, clientsFail.length,
          'EXCLUDED_NO_FAILURE_IN_DATASET'
        );
        continue;
      }

      clientsSucc.forEach(c => masterClientSet.add(c));
      clientsFail.forEach(c => masterClientSet.add(c));
      pairClientMap.set(`${preVersion}_${postVersion}`, { succ: clientsSucc, fail: clientsFail });
    }

    const allClients = Array.from(masterClientSet);
    if (allClients.length === 0) continue;

    console.log(`\n[Extract] ${libName} (${allClients.length} unique clients)...`);
    const rawMasterHistory = await ExtractVersion.extractVersion_master(allClients, libName);

    // リリース履歴を付加 (フォールバックあり)
    const masterHistory = rawMasterHistory.map(clientData => {
      const repoPath = WorkspaceManager.resolveSourcePath('../../clonedata/clientRepos', libName, clientData.C_client);
      const enrichedVerList = clientData.verList.map((v: any) => ({
        ...v,
        C_releases: repoPath ? getReleaseHistory(repoPath, libName, v.C_commitID) : []
      }));
      return { ...clientData, verList: enrichedVerList };
    });

    saveAllHistory(base, libName, masterHistory);

    for (const task of tasks) {
      const pairClients = pairClientMap.get(`${task.preVersion}_${task.postVersion}`);
      if (!pairClients) continue;

      const historySucc = masterHistory.filter(c => pairClients.succ.includes(c.C_client));
      const historyFail = masterHistory.filter(c => pairClients.fail.includes(c.C_client));

      if (C.DEBUG_MODE) {
        console.log(`[DEBUG] ${task.libName} (${task.preVersion} -> ${task.postVersion}): succ=${historySucc.length}, fail=${historyFail.length}`);
      }

      // Clone Fallback: 件数が 0 でも記録して続行
      const succSummary = await saveAndAnalyzeData(task, 'success', C.runMode, base, historySucc);
      const failSummary = await saveAndAnalyzeData(task, 'failure', C.runMode, base, historyFail);
      if (succSummary) masterTrackingSummaries.push(succSummary);
      if (failSummary) masterTrackingSummaries.push(failSummary);

      appendCloneLog(
        [validCloneLogPath],
        task.libName, task.preVersion, task.postVersion,
        historySucc.length, historyFail.length, 'TARGET_ACCEPTED'
      );
    }
  }

  writeAggregateCsv(base, masterTrackingSummaries);
  console.log(`\n[Done] verHist(full): ${base}`);
}

// ==========================================
// Partial モード
// ==========================================

async function runPartialMode(): Promise<void> {
  const C = CONFIG.PARTIAL;
  const base = verHistBase('partial', RUN_ID);

  if (!fs.existsSync(C.myDataPath)) {
    console.error(`[Error] ${C.myDataPath} は Partial モードで必須です。`);
    process.exit(1);
  }

  console.log(`\n==================================================`);
  console.log(`[Mode] PARTIAL`);
  console.log(`==================================================`);

  const { validCloneLogPath, invalidCloneLogPath } = initSummaryCsvs(base);

  console.log(`[Init] Loading datasets...`);
  const data: Item[] = await LoadJson.item(CONFIG.testResultPath);
  const libVersionRanges = JSON.parse(fs.readFileSync(C.myDataPath, 'utf-8')) as {
    libName: string; preVersion: string; postVersion: string;
  }[];

  const tasksByLib = new Map<string, any[]>();
  for (const task of libVersionRanges) {
    if (!tasksByLib.has(task.libName)) tasksByLib.set(task.libName, []);
    tasksByLib.get(task.libName)!.push(task);
  }

  const masterTrackingSummaries: TrackingSummary[] = [];

  for (const [libName, tasks] of tasksByLib.entries()) {
    const masterClientSet = new Set<string>();
    const pairClientMap = new Map<string, { succ: string[]; fail: string[] }>();

    for (const task of tasks) {
      const { preVersion, postVersion } = task;
      const list1     = data.filter(i => matchLib(i, libName) && i.L__version === preVersion  && i.state === 'success').map(i => i.S__nameWithOwner);
      const list2Succ = data.filter(i => matchLib(i, libName) && i.L__version === postVersion && i.state === 'success').map(i => i.S__nameWithOwner);
      const list2Fail = data.filter(i => matchLib(i, libName) && i.L__version === postVersion && i.state === 'failure').map(i => i.S__nameWithOwner);

      const clientsSucc = [...new Set(list2Succ.filter(v => list1.includes(v)))];
      const clientsFail = [...new Set(list2Fail.filter(v => list1.includes(v)))];

      if (clientsFail.length === 0) {
        appendCloneLog(
          [invalidCloneLogPath],
          task.libName, task.preVersion, task.postVersion,
          clientsSucc.length, clientsFail.length,
          'EXCLUDED_NO_FAILURE_IN_DATASET'
        );
        continue;
      }

      clientsSucc.forEach(c => masterClientSet.add(c));
      clientsFail.forEach(c => masterClientSet.add(c));
      pairClientMap.set(`${preVersion}_${postVersion}`, { succ: clientsSucc, fail: clientsFail });
    }

    const allClients = Array.from(masterClientSet);
    if (allClients.length === 0) continue;

    console.log(`\n[Extract] ${libName} (${allClients.length} clients)...`);
    const rawMasterHistory = await ExtractVersion.extractVersion_master(allClients, libName);

    // リリース履歴を付加 (フォールバックあり)
    const masterHistory = rawMasterHistory.map(clientData => {
      const repoPath = WorkspaceManager.resolveSourcePath('../../clonedata/clientRepos', libName, clientData.C_client);
      const enrichedVerList = clientData.verList.map((v: any) => ({
        ...v,
        C_releases: repoPath ? getReleaseHistory(repoPath, libName, v.C_commitID) : []
      }));
      return { ...clientData, verList: enrichedVerList };
    });

    saveAllHistory(base, libName, masterHistory);

    for (const task of tasks) {
      const pairClients = pairClientMap.get(`${task.preVersion}_${task.postVersion}`);
      if (!pairClients) continue;

      const historySucc = masterHistory.filter(c => pairClients.succ.includes(c.C_client));
      const historyFail = masterHistory.filter(c => pairClients.fail.includes(c.C_client));

      const succSummary = await saveAndAnalyzeData(task, 'success', C.runMode, base, historySucc);
      const failSummary = await saveAndAnalyzeData(task, 'failure', C.runMode, base, historyFail);
      if (succSummary) masterTrackingSummaries.push(succSummary);
      if (failSummary) masterTrackingSummaries.push(failSummary);

      appendCloneLog(
        [validCloneLogPath],
        task.libName, task.preVersion, task.postVersion,
        historySucc.length, historyFail.length, 'TARGET_ACCEPTED'
      );
    }
  }

  writeAggregateCsv(base, masterTrackingSummaries);
  console.log(`\n[Done] verHist(partial): ${base}`);
}

// ==========================================
// エントリーポイント
// ==========================================
(async () => {
  if (MODE === 'full') {
    await runFullMode();
  } else if (MODE === 'partial') {
    await runPartialMode();
  } else {
    console.error(`[Error] 不明なモード: "${MODE}". "full" または "partial" を指定してください。`);
    process.exit(1);
  }
})();
