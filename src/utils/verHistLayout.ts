// verHist 系（verHist.ts / verHistFromRBC.ts）共通の出力レイアウト・集計・保存ロジック

import fs from "fs";
import path from "path";
import { VersionPair } from "../types/VersionPair";

import LoadJson from "./loadJson";
import CreateVersionPairs from "../core/create_version_pairs";
import OutputJson from "./output_json";
import TargetCommits from "../analysis/targetCommits";
import VersionUtil from "../analysis/versionUtil";
import { trackPostUpdate } from "../analysis/postUpdateTracker";

export type InternalRunMode = 'extract' | 'analyze' | 'full';

export interface TrackingSummary {
  libName: string; preVersion: string; postVersion: string; state: string;
  originalClients: number; targetUpdatedClients: number;
  maintained: number; upgradedFurther: number; totalDowngrades: number;
  downgradeR1: number; downgradeR2: number; downgradeR3: number; noReleaseCount: number;
}

const HISTORY_ROOT = '../../outputs/history/ClientFixTrace/verHist';

// ---- パス解決（いずれも process.cwd()=src 相対の base を受け取る） ----

/** history/verHist/<mode>/<RUN_ID> のベース文字列 */
export function verHistBase(mode: string, runId: string): string {
  return `${HISTORY_ROOT}/${mode}/${runId}`;
}
export function summaryDir(base: string): string {
  return path.resolve(process.cwd(), `${base}/_summary`);
}
export function allHistoryDir(base: string): string {
  return path.resolve(process.cwd(), `${base}/_allHistory`);
}
/** <base>/<lib>@<post>/<state> */
export function stateDir(base: string, libName: string, postVersion: string, state: string): string {
  return path.resolve(process.cwd(), `${base}/${libName}@${postVersion}/${state}`);
}

// ---- CSV ----

const CLONE_CSV_HEADER = 'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status\n';

/** _summary/ を作り valid/invalid CSV を初期化 */
export function initSummaryCsvs(base: string): { validCloneLogPath: string; invalidCloneLogPath: string } {
  const dir = summaryDir(base);
  OutputJson.createDir(dir);
  const validCloneLogPath   = path.join(dir, 'valid_clone_summary.csv');
  const invalidCloneLogPath = path.join(dir, 'invalid_clone_summary.csv');
  fs.writeFileSync(validCloneLogPath, CLONE_CSV_HEADER, 'utf8');
  fs.writeFileSync(invalidCloneLogPath, CLONE_CSV_HEADER, 'utf8');
  return { validCloneLogPath, invalidCloneLogPath };
}

export function appendCloneLog(
  logPaths: string[], libName: string, preVer: string, postVer: string,
  succCount: number, failCount: number, status: string
): void {
  const line = `${libName},${preVer},${postVer},${succCount},${failCount},${status}\n`;
  for (const p of logPaths) fs.appendFileSync(p, line, 'utf8');
}

/** _summary/aggregate_tracking_summary.csv を書き出す */
export function writeAggregateCsv(base: string, summaries: TrackingSummary[]): void {
  if (summaries.length === 0) return;
  const dir = summaryDir(base);
  OutputJson.createDir(dir);
  const header =
    'Library,PreVersion,PostVersion,State,OriginalClients,TargetUpdatedClients,' +
    'Maintained,UpgradedFurther,TotalDowngrades,Downgrade_R1,Downgrade_R2,Downgrade_R3,NoReleaseCount\n';
  const rows = summaries.map(s =>
    `${s.libName},${s.preVersion},${s.postVersion},${s.state},${s.originalClients},` +
    `${s.targetUpdatedClients},${s.maintained},${s.upgradedFurther},${s.totalDowngrades},` +
    `${s.downgradeR1},${s.downgradeR2},${s.downgradeR3},${s.noReleaseCount}`
  ).join('\n');
  fs.writeFileSync(path.join(dir, 'aggregate_tracking_summary.csv'), header + rows, 'utf8');
}

// ---- 分類・保存 ----

function classifyTypes(
  data: VersionPair[], base: string, libName: string, postVersion: string, state: string
): void {
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const outDir = path.join(stateDir(base, libName, postVersion, state), 'sorted');
  OutputJson.createDir(outDir);
  (['update', 'downgrade', 'same'] as const).forEach(type => {
    fs.writeFileSync(
      path.join(outDir, `${type}.json`),
      JSON.stringify(sorted.filter(item => item.type === type), null, 2)
    );
  });
}

/** ライブラリ全履歴を _allHistory/ に保存 */
export function saveAllHistory(base: string, libName: string, masterHistory: any[]): void {
  if (masterHistory.length === 0) return;
  const dir = allHistoryDir(base);
  OutputJson.createDir(dir);
  const safeLibName = libName.replace(/[^a-zA-Z0-9_-]/g, '_');
  fs.writeFileSync(path.join(dir, `${safeLibName}_all_history.json`), JSON.stringify(masterHistory, null, 2));
}

/**
 * 履歴 JSON 保存 ＋ 後続リリース追跡 ＋ ペア集計・分類
 * 出力先: <base>/<lib>@<post>/<state>/（固定ファイル名）
 */
export async function saveAndAnalyzeData(
  libTask: { libName: string; preVersion: string; postVersion: string },
  state: string,
  runMode: InternalRunMode,
  base: string,
  verHistory: any[] = [],
  targetPath: string = ''
): Promise<TrackingSummary | null> {
  const { libName, preVersion, postVersion } = libTask;
  const outputDir = stateDir(base, libName, postVersion, state);
  let population = 0;

  // EXTRACT: 履歴 JSON 保存（固定名 / detect.ts は version_history-<state> を探す）
  if ((runMode === 'extract' || runMode === 'full') && verHistory.length > 0) {
    population = verHistory.length;
    OutputJson.createDir(outputDir);
    fs.writeFileSync(
      path.join(outputDir, `version_history-${state}.json`),
      JSON.stringify(verHistory, null, 2)
    );
  }

  if (runMode !== 'analyze' && runMode !== 'full') return null;

  // analyze モードは外部の履歴 JSON を読む
  if (runMode === 'analyze' && targetPath.length > 0) {
    if (!fs.existsSync(targetPath)) {
      console.error(`  [Error] analyzeTargetHistoryPath does not exist: ${targetPath}`);
      return null;
    }
    verHistory = await LoadJson.clientVer(targetPath);
  }

  population = verHistory.length;
  const summary: TrackingSummary = {
    libName, preVersion, postVersion, state,
    originalClients: population, targetUpdatedClients: 0,
    maintained: 0, upgradedFurther: 0, totalDowngrades: 0,
    downgradeR1: 0, downgradeR2: 0, downgradeR3: 0, noReleaseCount: 0
  };
  if (population === 0) return summary;

  // ANALYZE: 更新コミットを特定 → 後続リリースを追跡
  const targets = TargetCommits.get(verHistory, libName, postVersion);
  summary.targetUpdatedClients = targets.length;

  const postUpdateTracking = trackPostUpdate(targets, verHistory, postVersion);
  OutputJson.createDir(outputDir);
  fs.writeFileSync(
    path.join(outputDir, `post_update_tracking-${state}.json`),
    JSON.stringify(postUpdateTracking, null, 2)
  );

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

  // バージョンペアの集計・分類保存
  const inputList = targets.map((t: any) => [
    VersionUtil.normalize(t.L_preLibVersion),
    VersionUtil.normalize(t.L_postLibVersion)
  ]);
  const pairs = CreateVersionPairs.create_version_pairs(inputList, libName, 1);
  fs.writeFileSync(
    path.join(outputDir, `result_pairs-${state}.json`),
    JSON.stringify(pairs, null, 2)
  );
  classifyTypes(pairs, base, libName, postVersion, state);

  return summary;
}
