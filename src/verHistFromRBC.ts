// ==========================================
// verHistFromRBC.ts
// ------------------------------------------
// R-BC が検出したクライアント（テスト失敗側 + テスト成功側）を起点に
// verHist（バージョン履歴抽出・更新追跡）を実行する。
//
// 通常の verHist.ts (full) は test_result.json の success/failure membership から
// クライアントを決めるが、本ファイルは membership を R-BC の検出結果
//   outputs/latest/R-BC/<mode>/<lib>_<cleanVer>/detectByPattern/{failure,success}_detect.json
// の detectedClients から取得する。
//
// 用途:
//   - test_result.json 以外のデータで実行したい
//   - 全クライアントが test_result に含まれない場合
//
// 動作の仕組み（ライブラリ単位で union → 1回だけ抽出）は verHist.ts の full モードに準拠。
//   → 同一クライアントを複数バージョンで重複調査するムダを避ける。
//
// 実行: npx ts-node verHistFromRBC.ts [RBC_MODE]   RBC_MODE=0/1/2 (既定 2)
// ==========================================

import fs from "fs";
import path from "path";
import { VersionPair } from "./types/VersionPair";

import LoadJson from "./utils/loadJson";
import ExtractVersion from "./core/extractVersion";
import CreateVersionPairs from "./core/create_version_pairs";
import OutputJson from "./utils/output_json";
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

interface TaskInput { libName: string; preVersion: string; postVersion: string; }

// ==========================================
// 実行 ID: Meta Makefile からの BCPG_RUN_ID があればそれを使用、なければ実行時に生成
// 出力は outputs/history/ClientFixTrace/verHist/<RUN_ID>/ に書き、Meta Makefile が outputs/latest/ClientFixTrace/ にコピーする
// ==========================================
const RUN_ID: string = process.env.BCPG_RUN_ID ?? OutputJson.formatDateTime(new Date());

// CLI 引数で R-BC のモードを選択 (0=method / 1=type-method / 2=type-method-object)
const RBC_MODE = (['0', '1', '2'].includes(process.argv[2]) ? Number(process.argv[2]) : 2) as 0 | 1 | 2;

// ==========================================
// INPUT: 実行設定
// ==========================================
const CONFIG = {
  // 入出力パスは親ディレクトリ（BCPatternGen メタリポ）配下を参照する
  // 単体実行は現在サポートされない（README 参照）

  /** タスク（lib-version ペア）の定義。ドット付きの正確な版が必要なためここから読む */
  taskListPath: '../../datasets/targets.json',

  /** R-BC 検出結果(latest)のモード別ルート。detect.ts の RBC_M0/1/2 と同じ */
  RBC_ROOT: {
    0: '../../outputs/latest/R-BC/method',
    1: '../../outputs/latest/R-BC/type-method',
    2: '../../outputs/latest/R-BC/type-method-object',
  } as Record<number, string>,

  outputBaseDir: `../../outputs/history/ClientFixTrace/verHist/${RUN_ID}`,

  /** クライアントリポジトリ（コミット履歴の参照元） */
  clientReposDir: '../../clonedata/clientRepos',
};

// ==========================================
// 共通ユーティリティ（verHist.ts の full モードと同一）
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
 * バージョン履歴を保存し、ペア集計・分類まで行う共通処理（verHist.ts と同一）。
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
// R-BC 検出結果の読み込み
// ==========================================

/**
 * R-BC の detectByPattern 出力から detectedClients (owner/repo の配列) を取得する。
 * フォルダ自体が存在しない場合は null（= R-BC 出力なし）を返す。
 * @param state 'failure' | 'success'
 */
function readDetectedClients(
  rbcRoot: string, libName: string, postVersion: string, state: 'failure' | 'success'
): string[] | null {
  const cleanVersion = postVersion.replace(/[^a-zA-Z0-9]/g, '');
  const detectPath = path.resolve(
    process.cwd(), rbcRoot, `${libName}_${cleanVersion}`, 'detectByPattern', `${state}_detect.json`
  );
  if (!fs.existsSync(detectPath)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(detectPath, 'utf-8'));
    return Array.isArray(json.detectedClients) ? json.detectedClients : [];
  } catch (e) {
    console.error(`  [Warn] detect.json の読み込みに失敗: ${detectPath}`);
    return [];
  }
}

// ==========================================
// メイン: R-BC 検出クライアント起点の full 実行
// ==========================================

async function run(): Promise<void> {
  const rbcRoot = CONFIG.RBC_ROOT[RBC_MODE];
  const runMode: InternalRunMode = 'full';
  const outputBaseDir = CONFIG.outputBaseDir;
  const dateStr = `${RUN_ID}-rbcM${RBC_MODE}`;

  console.log(`\n==================================================`);
  console.log(`[Mode] verHistFromRBC (R-BC mode ${RBC_MODE})`);
  console.log(`[Source] ${rbcRoot}`);
  console.log(`==================================================`);

  // R-BC 出力ルートの存在確認
  if (!fs.existsSync(path.resolve(process.cwd(), rbcRoot))) {
    console.error(`[Error] R-BC の検出結果が見つかりません: ${rbcRoot}`);
    console.error(`        先に R-BC を実行してください（例: make rbc-obj）。`);
    process.exit(1);
  }

  // タスクリスト（ドット付きの版を取得）
  if (!fs.existsSync(CONFIG.taskListPath)) {
    console.error(`[Error] タスクリストがありません: ${CONFIG.taskListPath}`);
    process.exit(1);
  }
  const tasks = JSON.parse(fs.readFileSync(CONFIG.taskListPath, 'utf-8')) as TaskInput[];
  if (tasks.length === 0) {
    console.error(`[Error] タスクが 0 件です: ${CONFIG.taskListPath}`);
    process.exit(1);
  }
  console.log(`[Init] Loaded ${tasks.length} tasks from ${CONFIG.taskListPath}`);

  // 出力ディレクトリ・ログの準備（verHist full と同じ構造）
  const cloneResultDir  = path.resolve(process.cwd(), `${outputBaseDir}/cloneResult/${dateStr}`);
  const versionDataRoot = path.resolve(process.cwd(), `${outputBaseDir}/versionData/${dateStr}`);
  const allVerHistDir   = path.resolve(process.cwd(), `${outputBaseDir}/allverHist/${dateStr}`);
  OutputJson.createDir(cloneResultDir);
  OutputJson.createDir(versionDataRoot);
  OutputJson.createDir(allVerHistDir);

  const validCloneLogPath     = path.join(cloneResultDir,  'valid_clone_summary.csv');
  const invalidCloneLogPath   = path.join(cloneResultDir,  'invalid_clone_summary.csv');
  const validVerDataLogPath   = path.join(versionDataRoot, 'valid_clone_summary.csv');
  const invalidVerDataLogPath = path.join(versionDataRoot, 'invalid_clone_summary.csv');

  const csvHeader = 'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status\n';
  [validCloneLogPath, invalidCloneLogPath, validVerDataLogPath, invalidVerDataLogPath]
    .forEach(p => fs.writeFileSync(p, csvHeader, 'utf8'));

  // ライブラリ単位でタスクをまとめる（同一クライアントの重複抽出を避けるため）
  const tasksByLib = new Map<string, TaskInput[]>();
  for (const task of tasks) {
    if (!tasksByLib.has(task.libName)) tasksByLib.set(task.libName, []);
    tasksByLib.get(task.libName)!.push(task);
  }

  const masterTrackingSummaries: TrackingSummary[] = [];

  for (const [libName, libTasks] of tasksByLib.entries()) {
    // このライブラリに関係する全クライアントを union してから 1 回だけ抽出する
    const masterClientSet = new Set<string>();
    const pairClientMap = new Map<string, { succ: string[]; fail: string[] }>();

    for (const task of libTasks) {
      const { preVersion, postVersion } = task;

      const failDetected = readDetectedClients(rbcRoot, libName, postVersion, 'failure');
      const succDetected = readDetectedClients(rbcRoot, libName, postVersion, 'success');

      // R-BC 出力が存在しない（= 検出未実施）の場合はスキップ
      if (failDetected === null && succDetected === null) {
        appendCloneLog(
          [invalidCloneLogPath, invalidVerDataLogPath],
          task.libName, task.preVersion, task.postVersion, 0, 0,
          'EXCLUDED_NO_RBC_OUTPUT'
        );
        continue;
      }

      const clientsFail = [...new Set(failDetected ?? [])];
      const clientsSucc = [...new Set(succDetected ?? [])];

      // BC Loss Filter: Failure 検出が 0 件なら除外（verHist full と同じ方針）
      if (clientsFail.length === 0) {
        appendCloneLog(
          [invalidCloneLogPath, invalidVerDataLogPath],
          task.libName, task.preVersion, task.postVersion,
          clientsSucc.length, clientsFail.length,
          'EXCLUDED_NO_FAILURE_DETECTED'
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
      const repoPath = WorkspaceManager.resolveSourcePath(CONFIG.clientReposDir, libName, clientData.C_client);
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

    for (const task of libTasks) {
      const pairClients = pairClientMap.get(`${task.preVersion}_${task.postVersion}`);
      if (!pairClients) continue;

      const historySucc = masterHistory.filter(c => pairClients.succ.includes(c.C_client));
      const historyFail = masterHistory.filter(c => pairClients.fail.includes(c.C_client));

      const succSummary = await saveAndAnalyzeData(task, 'success', dateStr, runMode, outputBaseDir, historySucc);
      const failSummary = await saveAndAnalyzeData(task, 'failure', dateStr, runMode, outputBaseDir, historyFail);
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

  console.log(`\n[Done] versionData: ${versionDataRoot}`);
  console.log(`       detect.ts で使う場合は VERSION_DATA_DIR をこの versionData/${dateStr} に向ける`);
}

// ==========================================
// エントリーポイント
// ==========================================
(async () => {
  await run();
})();
