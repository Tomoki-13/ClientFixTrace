import fs from "fs";
import path from "path";
import { TargetUpdate, ClientTrack, ExcludedClient } from "../types/AnalysisTypes";

/**
 * clone_summary.csv を読み込み、TargetUpdate オブジェクトの配列に変換する。
 */
function loadCloneSummary(csvPath: string): TargetUpdate[] {
  if (!fs.existsSync(csvPath)) return [];
  const lines = fs.readFileSync(csvPath, 'utf-8').split(/\r?\n/).filter(l => l.trim() !== '');
  const tasks: TargetUpdate[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length < 6) continue;
    tasks.push({
      libName: cols[0],
      preVersion: cols[1],
      postVersion: cols[2],
      SuccessCloned: Number(cols[3]) || 0,
      FailureCloned: Number(cols[4]) || 0,
      Status: cols[5]
    });
  }
  return tasks;
}

/**
 * detect 用のメイン解析結果 (analysis_summary_*.csv) を出力する。
 * all / success / failure の 3 種類を書き出す。
 */
function writeFullExecutionStats(stats: any[], resultBaseDir: string, dateStr: string): void {
  if (stats.length === 0) return;
  const safeDateStr = dateStr.replace(/[: ]/g, '_');
  const csvHeader =
    'Library,PreVersion,PostVersion,State,Phase,RBC_DetectedClients,' +
    'TargetUpdatedClients,ActiveAnalyzed,NotFixed_PatternDetected,' +
    'Fixed_ImplementationChanged,Downgraded,NoRelease,UnknownError\n';

  const writeType = (type: 'all' | 'success' | 'failure') => {
    const validStats = stats.filter(s => {
      if (type !== 'all' && s.state !== type) return false;
      const count = type === 'success' ? s.rbcPatternCountSuccess
                  : type === 'failure' ? s.rbcPatternCountFailure
                  : s.rbcPatternCountAll;
      return count > 0;
    });
    if (validStats.length === 0) return;

    const csvPath = path.join(resultBaseDir, dateStr, `analysis_summary_${type}_${safeDateStr}.csv`);
    const rows = validStats.map(s => {
      const count = type === 'success' ? s.rbcPatternCountSuccess
                  : type === 'failure' ? s.rbcPatternCountFailure
                  : s.rbcPatternCountAll;
      return `${s.library},${s.preVersion},${s.postVersion},${s.state},${s.phase},${count},` +
             `${s.targetUpdatedClients},${s.activeAnalyzed},${s.notFixed_PatternDetected},` +
             `${s.fixed_ImplementationChanged},${s.downgraded},${s.noRelease},${s.unknownError}`;
    }).join('\n');
    fs.writeFileSync(csvPath, csvHeader + rows, 'utf8');
    if (type === 'all') console.log(`\n[Done] Summary CSV generated: ${csvPath}`);
  };

  writeType('all');
  writeType('success');
  writeType('failure');

  writeCondensedStats(stats, resultBaseDir, dateStr, safeDateStr);
}

/**
 * update〜release_3 を1行に集約した簡易サマリー (analysis_condensed_*.csv) を出力する。
 *
 * 各カラムの意味:
 *   RBC_DetectedClients     : R-BC がパターン合致と判定したクライアント数
 *   TargetUpdatedClients    : バージョン履歴に存在しライブラリを更新したクライアント数
 *   ActiveAnalyzed          : 更新コミット時点でアクティブ(解析対象)だったクライアント数
 *   Fixed_AtUpdate          : 更新コミットと同時に実装を修正していたクライアント数
 *   Fixed_AtR1/R2/R3        : 各リリースで新たに修正したクライアント数(累計ではなく各フェーズの増分)
 *   Fixed_Total             : update〜R3 の修正合計
 *   Downgraded              : ライブラリをダウングレードして回避したクライアント数(最終フェーズ時点)
 *   NoRelease               : 追跡期間中にリリースが存在しなかったクライアント数(最終フェーズ時点)
 *   UnknownError            : バージョン情報取得失敗等で除外されたクライアント数(最終フェーズ時点)
 *   NotFixed_Final          : 最終フェーズ終了時点でもパターンが検出されたまま(未修正)のクライアント数
 */
function writeCondensedStats(
  stats: any[], resultBaseDir: string, dateStr: string, safeDateStr: string
): void {
  const PHASE_ORDER = ['update', 'release_1', 'release_2', 'release_3'] as const;

  // (library, preVersion, postVersion, state) でグループ化
  const groups = new Map<string, any[]>();
  for (const s of stats) {
    const key = `${s.library}|${s.preVersion}|${s.postVersion}|${s.state}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const header =
    'Library,PreVersion,PostVersion,State,RBC_DetectedClients,' +
    'TargetUpdatedClients,ActiveAnalyzed,' +
    'Fixed_AtUpdate,Fixed_AtR1,Fixed_AtR2,Fixed_AtR3,Fixed_Total,' +
    'Downgraded,NoRelease,UnknownError,NotFixed_Final\n';

  const rows: string[] = [];

  const allRows: string[] = [];
  const successRows: string[] = [];
  const failureRows: string[] = [];

  for (const phaseStats of groups.values()) {
    // フェーズを定義順に並べ、存在するものだけ使う
    const sorted = PHASE_ORDER
      .map(p => phaseStats.find((s: any) => s.phase === p))
      .filter(Boolean);
    if (sorted.length === 0) continue;

    const first = sorted[0];  // update フェーズ
    const last  = sorted[sorted.length - 1];
    const state: string = first.state;

    // state に応じた RBC 検出数を選択
    const rbcDetected = state === 'success' ? first.rbcPatternCountSuccess
                      : state === 'failure' ? first.rbcPatternCountFailure
                      : first.rbcPatternCountAll;
    if (rbcDetected <= 0) continue;

    const getFixed = (phase: string) =>
      sorted.find((s: any) => s.phase === phase)?.fixed_ImplementationChanged ?? 0;

    const fixedAtUpdate = getFixed('update');
    const fixedAtR1     = getFixed('release_1');
    const fixedAtR2     = getFixed('release_2');
    const fixedAtR3     = getFixed('release_3');
    const fixedTotal    = fixedAtUpdate + fixedAtR1 + fixedAtR2 + fixedAtR3;

    const row =
      `${first.library},${first.preVersion},${first.postVersion},${state},${rbcDetected},` +
      `${first.targetUpdatedClients},${first.activeAnalyzed},` +
      `${fixedAtUpdate},${fixedAtR1},${fixedAtR2},${fixedAtR3},${fixedTotal},` +
      `${last.downgraded},${last.noRelease},${last.unknownError},${last.notFixed_PatternDetected}`;

    allRows.push(row);
    if (state === 'success') successRows.push(row);
    if (state === 'failure') failureRows.push(row);
  }

  const writeCondensed = (type: 'all' | 'success' | 'failure', rows: string[]) => {
    if (rows.length === 0) return;
    const csvPath = path.join(resultBaseDir, dateStr, `analysis_condensed_${type}_${safeDateStr}.csv`);
    fs.writeFileSync(csvPath, header + rows.join('\n'), 'utf8');
    if (type === 'all') console.log(`[Done] Condensed CSV generated: ${csvPath}`);
  };

  writeCondensed('all',     allRows);
  writeCondensed('success', successRows);
  writeCondensed('failure', failureRows);
}

/**
 * クライアントごとの詳細トラッキング情報 (client_detailed_tracking_*.csv) を出力する。
 */
function writeClientTracks(tracks: ClientTrack[], resultBaseDir: string, dateStr: string): void {
  if (tracks.length === 0) return;
  const safeDateStr = dateStr.replace(/[: ]/g, '_');
  const header =
    'Library,Client,State,PreVersion,PostVersion,' +
    'Update_LibVer,Update_Status,R1_LibVer,R1_Status,' +
    'R2_LibVer,R2_Status,R3_LibVer,R3_Status\n';
  const rows = tracks.map(t =>
    `${t.Library},${t.Client},${t.State},${t.PreVersion},${t.PostVersion},` +
    `${t.Update_LibVer},${t.Update_Status},${t.R1_LibVer},${t.R1_Status},` +
    `${t.R2_LibVer},${t.R2_Status},${t.R3_LibVer},${t.R3_Status}`
  ).join('\n');
  const csvPath = path.join(resultBaseDir, dateStr, `client_detailed_tracking_${safeDateStr}.csv`);
  fs.writeFileSync(csvPath, header + rows, 'utf8');
}

/**
 * 解析から除外されたクライアント情報 (excluded_clients_summary_*.csv) を出力する。
 */
function writeExcludedClients(clients: ExcludedClient[], resultBaseDir: string, dateStr: string): void {
  if (clients.length === 0) return;
  const safeDateStr = dateStr.replace(/[: ]/g, '_');
  const header = 'Library,Client,State,PreVersion,PostVersion\n';
  const rows = clients.map(e =>
    `${e.Library},${e.Client},${e.State},${e.PreVersion},${e.PostVersion}`
  ).join('\n');
  const csvPath = path.join(resultBaseDir, dateStr, `excluded_clients_summary_${safeDateStr}.csv`);
  fs.writeFileSync(csvPath, header + rows, 'utf8');
}

export default { loadCloneSummary, writeFullExecutionStats, writeClientTracks, writeExcludedClients };
