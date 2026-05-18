// src/utils/csvHandler.ts
import fs from "fs";
import path from "path";
import { TargetUpdate, ClientTrack, ExcludedClient } from "../types/AnalysisTypes";

export default class CsvHandler {
  /**
   * clone_summary.csv を読み込み、TargetUpdate オブジェクトの配列に変換します。
   */
  static loadCloneSummary(csvPath: string): TargetUpdate[] {
    if (!fs.existsSync(csvPath)) {
      return [];
    }
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');
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
   * detect-full 用のメイン解析結果 (analysis_summary_*.csv) を出力します。
   */
  static writeFullExecutionStats(stats: any[], resultBaseDir: string, dateStr: string) {
    if (stats.length === 0) return;
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    const csvHeader = 'Library,PreVersion,PostVersion,State,Phase,RBC_TotalPatternCount,TargetUpdatedClients,ActiveAnalyzed,NotFixed_PatternDetected,Fixed_ImplementationChanged,Downgraded,NoRelease,UnknownError\n';

    const writeType = (type: 'all' | 'success' | 'failure') => {
      const validStats = stats.filter(stat => {
        let targetRbcCount = stat.rbcPatternCountAll;
        if (type === 'success') targetRbcCount = stat.rbcPatternCountSuccess;
        else if (type === 'failure') targetRbcCount = stat.rbcPatternCountFailure;
        return targetRbcCount > 0;
      });

      if (validStats.length === 0) return;

      const csvPath = path.join(resultBaseDir, dateStr, `analysis_summary_${type}_${safeDateStr}.csv`);
      const csvRows = validStats.map(stat => {
        let targetRbcCount = stat.rbcPatternCountAll;
        if (type === 'success') targetRbcCount = stat.rbcPatternCountSuccess;
        else if (type === 'failure') targetRbcCount = stat.rbcPatternCountFailure;

        return `${stat.library},${stat.preVersion},${stat.postVersion},${stat.state},${stat.phase},${targetRbcCount},${stat.targetUpdatedClients},${stat.activeAnalyzed},${stat.notFixed_PatternDetected},${stat.fixed_ImplementationChanged},${stat.downgraded},${stat.noRelease},${stat.unknownError}`;
      }).join('\n');
      fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf8');

      if (type === 'all') {
        console.log(`\n[Done] Summary CSV generated: ${csvPath}`);
      }
    };

    writeType('all');
    writeType('success');
    writeType('failure');
  }

  /**
   * detect_partial 用の解析結果 (analysis_summary_all_*.csv) を出力します。
   */
  static writePartialExecutionStats(stats: any[], resultBaseDir: string, dateStr: string) {
    if (stats.length === 0) return;
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    const csvHeader = 'Library,PreVersion,PostVersion,State,Phase,RBC_TotalPatternCount,TargetUpdatedClients,PostUpdateMatchedClients\n';

    const validStats = stats.filter(stat => stat.rbcTotalPatternCount > 0);
    if (validStats.length === 0) return;

    const csvPath = path.join(resultBaseDir, dateStr, `analysis_summary_all_${safeDateStr}.csv`);
    const csvRows = validStats.map(stat =>
      `${stat.library},${stat.preVersion},${stat.postVersion},${stat.state},${stat.phase},${stat.rbcTotalPatternCount},${stat.targetUpdatedClients},${stat.postUpdateMatchedClients}`
    ).join('\n');
    fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf8');
    
    console.log(`\n[Done] Summary CSV generated: ${csvPath}`);
  }

  /**
   * クライアントごとの詳細トラッキング情報 (client_detailed_tracking_*.csv) を出力します。
   */
  static writeClientTracks(tracks: ClientTrack[], resultBaseDir: string, dateStr: string) {
    if (tracks.length === 0) return;
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    const header = 'Library,Client,State,PreVersion,PostVersion,Update_LibVer,Update_Status,R1_LibVer,R1_Status,R2_LibVer,R2_Status,R3_LibVer,R3_Status\n';
    const rows = tracks.map(t =>
      `${t.Library},${t.Client},${t.State},${t.PreVersion},${t.PostVersion},${t.Update_LibVer},${t.Update_Status},${t.R1_LibVer},${t.R1_Status},${t.R2_LibVer},${t.R2_Status},${t.R3_LibVer},${t.R3_Status}`
    ).join('\n');

    const csvPath = path.join(resultBaseDir, dateStr, `client_detailed_tracking_${safeDateStr}.csv`);
    fs.writeFileSync(csvPath, header + rows, 'utf8');
  }

  /**
   * 解析から除外されたクライアント情報 (excluded_clients_summary_*.csv) を出力します。
   */
  static writeExcludedClients(clients: ExcludedClient[], resultBaseDir: string, dateStr: string) {
    if (clients.length === 0) return;
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    const header = 'Library,Client,State,PreVersion,PostVersion\n';
    const rows = clients.map(e =>
      `${e.Library},${e.Client},${e.State},${e.PreVersion},${e.PostVersion}`
    ).join('\n');

    const csvPath = path.join(resultBaseDir, dateStr, `excluded_clients_summary_${safeDateStr}.csv`);
    fs.writeFileSync(csvPath, header + rows, 'utf8');
  }
}