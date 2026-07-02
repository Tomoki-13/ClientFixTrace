// R-BC の検出クライアント(success/failure)を起点に verHist を実行
// verHist.ts(full) は test_result.json から membership を決めるが
// 本ファイルは R-BC の detectedClients を使用
// 実行: npx ts-node verHistFromRBC.ts [RBC_MODE]  (0/1/1.5/2/2.5, 既定 2)

import fs from "fs";
import path from "path";

import ExtractVersion from "./core/extractVersion";
import OutputJson from "./utils/output_json";
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

interface TaskInput { libName: string; preVersion: string; postVersion: string; }

// ==========================================
// 実行 ID / モード
// ==========================================
const RUN_ID: string = process.env.BCPG_RUN_ID ?? OutputJson.formatDateTime(new Date());

// CLI 引数で R-BC のモードを選択
//   0=method / 1=type-method / 2=type-method-object
//   1.5 / 2.5 = それぞれ 1 / 2 の no_unknown 版（unknown 型のみの呼び出しを除いた厳格版）
const VALID_RBC_MODES = ['0', '1', '1.5', '2', '2.5'];
const RBC_MODE = (VALID_RBC_MODES.includes(process.argv[2]) ? Number(process.argv[2]) : 2) as 0 | 1 | 1.5 | 2 | 2.5;

// .5 モードは整数部の出力ルートを流用し、detect サブディレクトリだけ _no_unknown にする
const EFFECTIVE_RBC_MODE = Math.floor(RBC_MODE) as 0 | 1 | 2;
const DETECT_SUBDIR = !Number.isInteger(RBC_MODE) ? 'detectByPattern_no_unknown' : 'detectByPattern';

// 出力 mode 名（latest ディレクトリ名 / verHist の mode 名に使用）
const RBC_MODE_NAME = ({
  0: 'method',
  1: 'type-method',
  1.5: 'type-method-no-unknown',
  2: 'type-method-object',
  2.5: 'type-method-object-no-unknown',
} as Record<number, string>)[RBC_MODE];

// ==========================================
// INPUT: 実行設定
// ==========================================
const CONFIG = {
  /** タスク（lib-version ペア）定義 / ドット付きの正確な版が必要なためここから読む */
  taskListPath: '../../datasets/targets.json',

  /** R-BC 検出結果(latest)のモード別ルート / detect.ts の RBC_M0/1/2 と同じ */
  RBC_ROOT: {
    0: '../../outputs/latest/R-BC/method',
    1: '../../outputs/latest/R-BC/type-method',
    2: '../../outputs/latest/R-BC/type-method-object',
  } as Record<number, string>,

  /** クライアントリポジトリ（コミット履歴の参照元） */
  clientReposDir: '../../clonedata/clientRepos',
};

// ==========================================
// R-BC 検出結果の読み込み
// ==========================================

/**
 * R-BC の detectByPattern[_no_unknown] 出力から detectedClients (owner/repo) を取得
 * フォルダが存在しない場合は null（= R-BC 出力なし）
 */
function readDetectedClients(
  rbcRoot: string, libName: string, postVersion: string, state: 'failure' | 'success'
): string[] | null {
  const cleanVersion = postVersion.replace(/[^a-zA-Z0-9]/g, '');
  const detectPath = path.resolve(
    process.cwd(), rbcRoot, `${libName}_${cleanVersion}`, DETECT_SUBDIR, `${state}_detect.json`
  );
  if (!fs.existsSync(detectPath)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(detectPath, 'utf-8'));
    return Array.isArray(json.detectedClients) ? json.detectedClients : [];
  } catch {
    console.error(`  [Warn] detect.json の読み込みに失敗: ${detectPath}`);
    return [];
  }
}

// ==========================================
// メイン
// ==========================================

async function run(): Promise<void> {
  const rbcRoot = CONFIG.RBC_ROOT[EFFECTIVE_RBC_MODE];
  const runMode: InternalRunMode = 'full';
  const base = verHistBase(`rbc-${RBC_MODE_NAME}`, RUN_ID);

  console.log(`\n==================================================`);
  console.log(`[Mode] verHistFromRBC (rbc-${RBC_MODE_NAME})`);
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

  const { validCloneLogPath, invalidCloneLogPath } = initSummaryCsvs(base);

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
          [invalidCloneLogPath],
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
          [invalidCloneLogPath],
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

    saveAllHistory(base, libName, masterHistory);

    for (const task of libTasks) {
      const pairClients = pairClientMap.get(`${task.preVersion}_${task.postVersion}`);
      if (!pairClients) continue;

      const historySucc = masterHistory.filter(c => pairClients.succ.includes(c.C_client));
      const historyFail = masterHistory.filter(c => pairClients.fail.includes(c.C_client));

      const succSummary = await saveAndAnalyzeData(task, 'success', runMode, base, historySucc);
      const failSummary = await saveAndAnalyzeData(task, 'failure', runMode, base, historyFail);
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
  console.log(`\n[Done] verHistFromRBC: ${base}`);
}

(async () => {
  await run();
})();
