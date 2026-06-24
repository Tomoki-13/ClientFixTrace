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
import WorkspaceManager from "./utils/workspaceManager";
import { getReleaseHistory } from "./git/getReleaseHistory";
import { trackPostUpdate } from "./analysis/postUpdateTracker";

type InternalRunMode = 'extract' | 'analyze' | 'full';

interface TrackingSummary {
  libName: string; preVersion: string; postVersion: string; state: string;
  originalClients: number; targetUpdatedClients: number;
  maintained: number; upgradedFurther: number; totalDowngrades: number;
  downgradeR1: number; downgradeR2: number; downgradeR3: number; noReleaseCount: number;
}

// ==========================================
// 実行 ID: Meta Makefile からの BCPG_RUN_ID があればそれを使用、なければ実行時に生成
// 出力は outputs/history/ClientFixTrace/verHist/<RUN_ID>/ に書き、Meta Makefile が outputs/latest/ClientFixTrace/ にコピーする
// ==========================================
const RUN_ID: string = process.env.BCPG_RUN_ID ?? OutputJson.formatDateTime(new Date());

// ==========================================
// INPUT: 実行設定
// ==========================================
const CONFIG = {
  /**
   * ソースコードを直接変更してモードを固定する場合はここを書き換える。
   * CLI引数が渡された場合はそちらが優先される。
   */
  DEFAULT_MODE: 'full' as 'full' | 'partial',

  // 入出力パスは親ディレクトリ（BCPatternGen メタリポ）配下を参照する
  // 単体実行は現在サポートされない（README 参照）

  // ===== 共通設定 =====
  testResultPath: '../../datasets/test_result.json',

  // ===== Full モード固有設定 =====
  FULL: {
    /** 空文字の場合は test_result.json から全件自動抽出 */
    myDataPath: '',
    outputBaseDir: `../../outputs/history/ClientFixTrace/verHist/${RUN_ID}`,
    /** 特定ライブラリのみに絞る場合に指定 (空文字=全件) */
    targetLibrary: '',
    runMode: 'full' as InternalRunMode,

    /**
     * デバッグモード: true にすると DEBUG_TARGETS のみを高速で処理する。
     * 長時間の全件抽出をスキップして挙動検証に使う。
     */
    DEBUG_MODE: false,
    DEBUG_TARGETS: [
      { libName: 'acorn', preVersion: '4.0.2', postVersion: '4.0.3' },
      { libName: 'acorn', preVersion: '4.0.4', postVersion: '4.0.5' },
      { libName: 'acorn', preVersion: '5.3.0', postVersion: '5.4.0' }
    ],

    // --- analyze モード専用 (runMode: 'analyze' のときのみ使用) ---
    analyzeTargetHistoryPath: '',
    analyzeState: 'failure',
    analyzeLibName: '',
    analyzePostVersion: ''
  },

  // ===== Partial モード固有設定 =====
  PARTIAL: {
    /** myDataPath は Partial モードで必須 */
    myDataPath: '../../datasets/targets.json',
    /**
     * Full モードの出力と同じルートを指定すれば detect.ts PARTIAL.VERSION_DATA_DIR と共有できる。
     * 分けたい場合は '../../outputs/latest/ClientFixTrace/partVerHist' などに変更する。
     */
    outputBaseDir: `../../outputs/history/ClientFixTrace/verHist/${RUN_ID}`,
    runMode: 'full' as InternalRunMode,
  }
};

// CLI引数 or CONFIG.DEFAULT_MODE でモードを決定
const MODE = (['full', 'partial'].includes(process.argv[2])
  ? process.argv[2]
  : CONFIG.DEFAULT_MODE) as 'full' | 'partial';

// ==========================================
// 共通ユーティリティ
// ==========================================

function appendCloneLog(
  logPaths: string[], libName: string, preVer: string, postVer: string,
  succCount: number, failCount: number, status: string
): void {
  const line = `${libName},${preVer},${postVer},${succCount},${failCount},${status}\n`;
  for (const p of logPaths) fs.appendFileSync(p, line, 'utf8');
}

function classifyTypes(
  data: VersionPair[], libName: string, postLibVersion: string,
  outputBaseDir: string, dateStr: string, state: string, countSuffix: string
): void {
  data = [...data].sort((a, b) => b.count - a.count);
  const outDir = path.join(outputBaseDir, 'sortData', dateStr, state, `${libName}-${postLibVersion}`);
  OutputJson.createDir(outDir);
  (['update', 'downgrade', 'same'] as const).forEach(type => {
    const filtered = data.filter(item => item.type === type);
    const outputPath = OutputJson.getUniquePath(outDir, '', `${type}_${countSuffix}`);
    fs.writeFileSync(outputPath, JSON.stringify(filtered, null, 2));
  });
}

/**
 * バージョン履歴を保存し、ペア集計・分類まで行う共通処理。
 * Full/Partial 両モードで共有する。
 */
async function saveAndAnalyzeData(
  libTask: any,
  state: string,
  dateStr: string,
  runMode: InternalRunMode,
  outputBaseDir: string,
  verHistory: any[] = [],
  targetPath: string = ''
): Promise<TrackingSummary | null> {
  const { libName, preVersion, postVersion } = libTask;
  const outputDir = path.resolve(
    process.cwd(),
    `${outputBaseDir}/versionData/${dateStr}/${state}/${libName}-${postVersion}`
  );
  let population = 0;

  // --- EXTRACT フェーズ: 履歴 JSON の保存 ---
  if ((runMode === 'extract' || runMode === 'full') && verHistory.length > 0) {
    population = verHistory.length;
    OutputJson.createDir(outputDir);
    const historyPath = OutputJson.getUniquePath(outputDir, `version_history-${state}`, `${population}total`);
    fs.writeFileSync(historyPath, JSON.stringify(verHistory, null, 2));
  }

  // --- ANALYZE フェーズ: ペア集計・分類保存 ---
  if (runMode === 'analyze' || runMode === 'full') {
    // analyze モードでは外部パスから履歴を読み込む
    if (runMode === 'analyze' && targetPath.length > 0) {
      if (fs.existsSync(targetPath)) {
        verHistory = await LoadJson.clientVer(targetPath);
      } else {
        console.error(`  [Error] analyzeTargetHistoryPath does not exist: ${targetPath}`);
        return null;
      }
    }

    population = verHistory.length;
    const summary: TrackingSummary = {
      libName, preVersion, postVersion, state,
      originalClients: population, targetUpdatedClients: 0,
      maintained: 0, upgradedFurther: 0, totalDowngrades: 0,
      downgradeR1: 0, downgradeR2: 0, downgradeR3: 0, noReleaseCount: 0
    };

    if (population > 0) {
      const targets = TargetCommits.get(verHistory, libName, postVersion);
      summary.targetUpdatedClients = targets.length;

      // 後続リリース追跡
      const postUpdateTracking = trackPostUpdate(targets, verHistory, postVersion);
      OutputJson.createDir(outputDir);
      const trackingPath = OutputJson.getUniquePath(
        outputDir, `post_update_tracking-${state}`, `${population}total`
      );
      fs.writeFileSync(trackingPath, JSON.stringify(postUpdateTracking, null, 2));

      const isDowngrade = (rel: any) => rel?.libVersionAtRelease?.includes('Downgraded');
      for (const track of postUpdateTracking) {
        if      (track.finalStatus === 'downgraded_eventually') summary.totalDowngrades++;
        else if (track.finalStatus === 'upgraded_eventually')   summary.upgradedFurther++;
        else if (track.finalStatus === 'maintained')            summary.maintained++;
        else if (track.finalStatus === 'no_release')            summary.noReleaseCount++;
        if (isDowngrade(track.releases[0])) summary.downgradeR1++;
        if (isDowngrade(track.releases[1])) summary.downgradeR2++;
        if (isDowngrade(track.releases[2])) summary.downgradeR3++;
      }

      // バージョンペアの集計・保存
      const inputList = targets.map((t: any) => [
        VersionUtil.normalize(t.L_preLibVersion),
        VersionUtil.normalize(t.L_postLibVersion)
      ]);
      const pairs = CreateVersionPairs.create_version_pairs(inputList, libName, 1);

      OutputJson.createDir(outputDir);
      const updateCount = pairs.filter(p => p.type === 'update').reduce((sum, p) => sum + p.count, 0);
      const countSuffix = `${updateCount}updated-${population}total`;
      const pairPath = OutputJson.getUniquePath(outputDir, `result_pairs-${state}`, countSuffix);
      fs.writeFileSync(pairPath, JSON.stringify(pairs, null, 2));

      classifyTypes(pairs, libName, postVersion, outputBaseDir, dateStr, state, countSuffix);
      return summary;
    }
    return summary;
  }
  return null;
}

// ==========================================
// Full モード
// ==========================================

async function runFullMode(): Promise<void> {
  const C = CONFIG.FULL;
  const outputBaseDir = C.outputBaseDir;

  let dateStr = RUN_ID;
  let libVersionRanges: { libName: string; preVersion: string; postVersion: string }[] = [];
  const suffix = C.DEBUG_MODE ? '-debug' : '';

  console.log(`\n==================================================`);
  console.log(`[Mode] FULL${C.DEBUG_MODE ? ' (DEBUG MODE)' : ''}`);
  console.log(`==================================================`);

  if (C.runMode !== 'full' && C.runMode !== 'extract') {
    // analyze モード専用
    await saveAndAnalyzeData(
      { libName: C.analyzeLibName, preVersion: 'unknown', postVersion: C.analyzePostVersion },
      C.analyzeState, dateStr, C.runMode, outputBaseDir, [], C.analyzeTargetHistoryPath
    );
    return;
  }

  dateStr += '-all' + suffix;

  const cloneResultDir  = path.resolve(process.cwd(), `${outputBaseDir}/cloneResult/${dateStr}`);
  const versionDataRoot = path.resolve(process.cwd(), `${outputBaseDir}/versionData/${dateStr}`);
  const allVerHistDir   = path.resolve(process.cwd(), `${outputBaseDir}/allverHist/${dateStr}`);

  OutputJson.createDir(cloneResultDir);
  OutputJson.createDir(versionDataRoot);
  OutputJson.createDir(allVerHistDir);

  const validCloneLogPath    = path.join(cloneResultDir,  'valid_clone_summary.csv');
  const invalidCloneLogPath  = path.join(cloneResultDir,  'invalid_clone_summary.csv');
  const validVerDataLogPath  = path.join(versionDataRoot, 'valid_clone_summary.csv');
  const invalidVerDataLogPath = path.join(versionDataRoot, 'invalid_clone_summary.csv');

  const csvHeader = 'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status\n';
  [validCloneLogPath, invalidCloneLogPath, validVerDataLogPath, invalidVerDataLogPath]
    .forEach(p => fs.writeFileSync(p, csvHeader, 'utf8'));

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

  // Full モードでは L__npm_pkg も参照する
  const matchLib = (item: Item, libName: string) =>
    (item.L__npm_pkg && item.L__npm_pkg === libName) || item.L__nameWithOwner.includes(libName);

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
          [invalidCloneLogPath, invalidVerDataLogPath],
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

    if (masterHistory.length > 0) {
      const safeLibName = libName.replace(/[^a-zA-Z0-9_-]/g, '_');
      fs.writeFileSync(
        path.join(allVerHistDir, `${safeLibName}_all_history.json`),
        JSON.stringify(masterHistory, null, 2)
      );
    }

    for (const task of tasks) {
      const pairClients = pairClientMap.get(`${task.preVersion}_${task.postVersion}`);
      if (!pairClients) continue;

      const historySucc = masterHistory.filter(c => pairClients.succ.includes(c.C_client));
      const historyFail = masterHistory.filter(c => pairClients.fail.includes(c.C_client));

      if (C.DEBUG_MODE) {
        console.log(`[DEBUG] ${task.libName} (${task.preVersion} -> ${task.postVersion}): succ=${historySucc.length}, fail=${historyFail.length}`);
      }

      // Clone Fallback: 件数が 0 でも記録して続行
      const succSummary = await saveAndAnalyzeData(task, 'success', dateStr, C.runMode, outputBaseDir, historySucc);
      const failSummary = await saveAndAnalyzeData(task, 'failure', dateStr, C.runMode, outputBaseDir, historyFail);
      if (succSummary) masterTrackingSummaries.push(succSummary);
      if (failSummary) masterTrackingSummaries.push(failSummary);

      appendCloneLog(
        [validCloneLogPath, validVerDataLogPath],
        task.libName, task.preVersion, task.postVersion,
        historySucc.length, historyFail.length, 'TARGET_ACCEPTED'
      );
    }
  }

  if (masterTrackingSummaries.length > 0) {
    const trackingCsvPath = path.join(versionDataRoot, 'aggregate_tracking_summary.csv');
    const trackHeader =
      'Library,PreVersion,PostVersion,State,OriginalClients,TargetUpdatedClients,' +
      'Maintained,UpgradedFurther,TotalDowngrades,Downgrade_R1,Downgrade_R2,Downgrade_R3,NoReleaseCount\n';
    const trackRows = masterTrackingSummaries.map(s =>
      `${s.libName},${s.preVersion},${s.postVersion},${s.state},${s.originalClients},` +
      `${s.targetUpdatedClients},${s.maintained},${s.upgradedFurther},${s.totalDowngrades},` +
      `${s.downgradeR1},${s.downgradeR2},${s.downgradeR3},${s.noReleaseCount}`
    ).join('\n');
    fs.writeFileSync(trackingCsvPath, trackHeader + trackRows, 'utf8');
    console.log(`\n[Done] Aggregate Tracking Summary: ${trackingCsvPath}`);
  }
}

// ==========================================
// Partial モード
// ==========================================

async function runPartialMode(): Promise<void> {
  const C = CONFIG.PARTIAL;
  const outputBaseDir = C.outputBaseDir;

  if (!fs.existsSync(C.myDataPath)) {
    console.error(`[Error] ${C.myDataPath} は Partial モードで必須です。`);
    process.exit(1);
  }

  const dateStr = OutputJson.formatDateTime(new Date()) + '-partial';

  console.log(`\n==================================================`);
  console.log(`[Mode] PARTIAL`);
  console.log(`==================================================`);

  const cloneResultDir  = path.resolve(process.cwd(), `${outputBaseDir}/cloneResult/${dateStr}`);
  const versionDataRoot = path.resolve(process.cwd(), `${outputBaseDir}/versionData/${dateStr}`);
  const allVerHistDir   = path.resolve(process.cwd(), `${outputBaseDir}/allverHist/${dateStr}`);

  OutputJson.createDir(cloneResultDir);
  OutputJson.createDir(versionDataRoot);
  OutputJson.createDir(allVerHistDir);

  const validCloneLogPath    = path.join(cloneResultDir,  'valid_clone_summary.csv');
  const invalidCloneLogPath  = path.join(cloneResultDir,  'invalid_clone_summary.csv');
  const validVerDataLogPath  = path.join(versionDataRoot, 'valid_clone_summary.csv');
  const invalidVerDataLogPath = path.join(versionDataRoot, 'invalid_clone_summary.csv');

  const csvHeader = 'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status\n';
  [validCloneLogPath, invalidCloneLogPath, validVerDataLogPath, invalidVerDataLogPath]
    .forEach(p => fs.writeFileSync(p, csvHeader, 'utf8'));

  console.log(`[Init] Loading datasets...`);
  const data: Item[] = await LoadJson.item(CONFIG.testResultPath);
  const libVersionRanges = JSON.parse(fs.readFileSync(C.myDataPath, 'utf-8')) as {
    libName: string; preVersion: string; postVersion: string;
  }[];

  // Full と同じ照合ロジック (L__npm_pkg 優先 + L__nameWithOwner フォールバック)
  const matchLib = (item: Item, libName: string) =>
    (item.L__npm_pkg && item.L__npm_pkg === libName) || item.L__nameWithOwner.includes(libName);

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
          [invalidCloneLogPath, invalidVerDataLogPath],
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

    if (masterHistory.length > 0) {
      const safeLibName = libName.replace(/[^a-zA-Z0-9_-]/g, '_');
      fs.writeFileSync(
        path.join(allVerHistDir, `${safeLibName}_all_history.json`),
        JSON.stringify(masterHistory, null, 2)
      );
    }

    for (const task of tasks) {
      const pairClients = pairClientMap.get(`${task.preVersion}_${task.postVersion}`);
      if (!pairClients) continue;

      const historySucc = masterHistory.filter(c => pairClients.succ.includes(c.C_client));
      const historyFail = masterHistory.filter(c => pairClients.fail.includes(c.C_client));

      const succSummary = await saveAndAnalyzeData(task, 'success', dateStr, C.runMode, outputBaseDir, historySucc);
      const failSummary = await saveAndAnalyzeData(task, 'failure', dateStr, C.runMode, outputBaseDir, historyFail);
      if (succSummary) masterTrackingSummaries.push(succSummary);
      if (failSummary) masterTrackingSummaries.push(failSummary);

      appendCloneLog(
        [validCloneLogPath, validVerDataLogPath],
        task.libName, task.preVersion, task.postVersion,
        historySucc.length, historyFail.length, 'TARGET_ACCEPTED'
      );
    }
  }

  if (masterTrackingSummaries.length > 0) {
    const trackingCsvPath = path.join(versionDataRoot, 'aggregate_tracking_summary.csv');
    const trackHeader =
      'Library,PreVersion,PostVersion,State,OriginalClients,TargetUpdatedClients,' +
      'Maintained,UpgradedFurther,TotalDowngrades,Downgrade_R1,Downgrade_R2,Downgrade_R3,NoReleaseCount\n';
    const trackRows = masterTrackingSummaries.map(s =>
      `${s.libName},${s.preVersion},${s.postVersion},${s.state},${s.originalClients},` +
      `${s.targetUpdatedClients},${s.maintained},${s.upgradedFurther},${s.totalDowngrades},` +
      `${s.downgradeR1},${s.downgradeR2},${s.downgradeR3},${s.noReleaseCount}`
    ).join('\n');
    fs.writeFileSync(trackingCsvPath, trackHeader + trackRows, 'utf8');
  }
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
