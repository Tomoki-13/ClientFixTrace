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
    'Library,PreVersion,PostVersion,State,Phase,RBC_TotalPatternCount,' +
    'TargetUpdatedClients,ActiveAnalyzed,NotFixed_PatternDetected,' +
    'Fixed_ImplementationChanged,Downgraded,NoRelease,UnknownError\n';

  const writeType = (type: 'all' | 'success' | 'failure') => {
    const validStats = stats.filter(s => {
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
