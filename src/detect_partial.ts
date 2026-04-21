import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { detectByPattern } from "../R-BC/src/core/detectByPattern";
import { ExtractFunctionCallsResult } from "../R-BC/src/types/ExtractFunctionCallsResult";

import StatusBar from "./utils/statusBar";
import GetTargetCommits from "./utils/targetCommits";
import OutputJson from "./utils/output_json";
import GetAllFiles from "./utils/getAllFiles";
import GetMatchedClients from './utils/getMatchedClients';

// ==========================================
// INPUT: 実行設定 (特定のライブラリを調べる立ち位置を維持)
// ==========================================
const CONFIG = {
  TASK_LIST_PATH: '../datasets/mydata/mydata.json',
  HISTORY_BASE_DIR: '../datasets/analysis_target/current/2026-02-24-08-48-48',
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/fulldataSample',
  SOURCE_CLIENT_REPOS: '../clientRepos',
  UPDATE_CLIENT_BASE: '../client_update',
  STATE: 'success',
  RESULT_BASE_DIR: '../output/specificData'
};
// ==========================================

StatusBar.init();

// 集計用データの型定義
interface ExecutionStat {
  library: string;                  // 対象のライブラリ名
  preVersion: string;               // 更新前のバージョン
  postVersion: string;              // 更新後のバージョン (ターゲットバージョン)
  state: string;                    // クライアントの状態
  phase: string;                    // 処理フェーズ (update / release)
  originalMatchedClients: number;   // 元々のパターンで検出されたクライアント
  targetUpdatedClients: number;     // Originalのうち、特定のバージョン(postVersion)に更新したクライアント
  postUpdateMatchedClients: number; // TargetUpdatedのうち、更新後もパターンを持つクライアント
}

(async () => {
  const taskList: { libName: string; preVersion?: string; postVersion: string }[] = JSON.parse(fs.readFileSync(CONFIG.TASK_LIST_PATH, 'utf-8'));

  const historyFiles = await GetAllFiles.getRecursively(CONFIG.HISTORY_BASE_DIR);
  const rbcFiles = await GetAllFiles.getRecursively(CONFIG.RBC_DATA_ROOT);

  const dateStr = OutputJson.formatDateTime(new Date());

  const summaryOutDir = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'specific-commits');
  OutputJson.createDir(summaryOutDir);

  const executionStats: ExecutionStat[] = [];
  const totalSteps = taskList.length;
  let currentStep = 0;

  for (const task of taskList) {
    currentStep++;
    const { libName, postVersion } = task;
    const preVersion = task.preVersion || 'unknown'; // mydata.json に preVersion が無い場合のフォールバック
    
    // 抽出側の命名規則に合わせ、英数字以外を除去
    const verKey = postVersion.replace(/[^a-zA-Z0-9]/g, '');

    StatusBar.update(`⏳ [${currentStep}/${totalSteps}] Processing: ${libName} (-> ${postVersion})`);

    const targetHistoryPath = historyFiles.find(f =>
      f.includes(CONFIG.STATE) && f.includes(`${libName}-${postVersion}`) &&
      path.basename(f).startsWith(`version_history-${CONFIG.STATE}`)
    );

    const rbcTargetDirBase = rbcFiles.find(f => f.includes(`${libName}_${verKey}`));
    const rbcTargetDir = rbcTargetDirBase ? rbcTargetDirBase.split(libName + '_' + verKey)[0] + libName + '_' + verKey : null;

    if (!targetHistoryPath || !rbcTargetDir) {
      console.warn(`\n[Warn] History or RBC data not found for ${libName}-${postVersion}. Skipping.`);
      continue;
    }

    const matchFilePath = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('matchResults.json') && f.includes(CONFIG.STATE));

    const detectPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('detectpatternlist.json'));
    const fallbackPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('patternList.json'));

    const patternFile = detectPatternFile || fallbackPatternFile;

    if (!matchFilePath || !patternFile) continue;

    const patternModeFlag = detectPatternFile ? 0 : 1;

    console.log(`\n--- [Analysis] ${libName}-${postVersion} ---`);

    const filteredHistory = GetMatchedClients.get(matchFilePath, targetHistoryPath);
    const targets = GetTargetCommits.get(filteredHistory, libName, postVersion);

    if (targets.length === 0) {
      console.log(`  [Skip] No valid updated clients found.`);
      continue;
    }

    const commitLogPath = path.resolve(summaryOutDir, `${libName}-${postVersion}_${CONFIG.STATE}_list.json`);
    const exportTargets = targets.map(t => ({
      client: t.C_client,
      libVersion: t.L_postLibVersion,
      commitID: t.C_commitID,
      tagCommitID: t.C_tagCommitID
    }));
    fs.writeFileSync(commitLogPath, JSON.stringify(exportTargets, null, 2));

    const patternData = JSON.parse(fs.readFileSync(patternFile, 'utf-8'));
    const rawPatterns: any[] = patternData.patterns ? patternData.patterns.map((p: any) => p.pattern) : patternData;
    const patterns: ExtractFunctionCallsResult[][][] = rawPatterns.map((p: any[]) =>
      p.map((bg: any[]) => bg.flatMap(b => Array.isArray(b) ? b : [b]))
    );

    const baseFolderName = `${libName}-${postVersion}_${CONFIG.STATE}`;
    const baseClonePath = path.resolve(process.cwd(), CONFIG.UPDATE_CLIENT_BASE, baseFolderName);
    const baseResultPath = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'results', baseFolderName);

    if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
    OutputJson.createDir(baseClonePath);

    const runAnalysis = async (type: 'update' | 'release') => {
      const absCloneDir = path.resolve(baseClonePath, type);
      const absOutDir = path.resolve(baseResultPath, type);
      const relativeCloneDir = path.relative(process.cwd(), absCloneDir);

      OutputJson.createDir(absCloneDir);
      OutputJson.createDir(absOutDir);

      let successCount = 0;
      for (const item of targets) {
        const targetHash = type === 'update' ? item.C_commitID : item.C_tagCommitID;
        if (!targetHash || targetHash === "no-subsequent-release") continue;

        // 特定クライアント向けの既存パス構造を維持
        const sourcePath = path.resolve(CONFIG.SOURCE_CLIENT_REPOS, libName, item.C_client);
        const destPath = path.resolve(absCloneDir, item.C_client);

        try {
          if (!fs.existsSync(sourcePath)) continue;
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.cpSync(sourcePath, destPath, { recursive: true });
          execSync(`git -C "${destPath}" checkout -f ${targetHash}`, { stdio: 'ignore' });
          successCount++;
        } catch (err) { /* ignore errors */ }
      }

      let detectedCount = 0;
      if (successCount > 0) {
        console.log(`  [Detect] Executing detectByPattern for ${type} (Clients: ${successCount}, PatternMode: ${patternModeFlag})`);
        const detectResult = await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, patternModeFlag);
        detectedCount = detectResult.totalClients;

        const outputFiles = fs.readdirSync(absOutDir).filter(f => f.endsWith('.json'));
        for (const file of outputFiles) {
          const oldPath = path.join(absOutDir, file);
          const ext = path.extname(file);
          const base = path.basename(file, ext);
          const newPath = path.join(absOutDir, `${base}_${detectedCount}${ext}`);
          fs.renameSync(oldPath, newPath);
        }
      }

      executionStats.push({
        library: libName,
        preVersion: preVersion,
        postVersion: postVersion,
        state: CONFIG.STATE,
        phase: type,
        originalMatchedClients: filteredHistory.length,
        targetUpdatedClients: targets.length,
        postUpdateMatchedClients: detectedCount
      });
    };

    await runAnalysis('update');
    await runAnalysis('release');
  }

  StatusBar.finish();

  if (executionStats.length > 0) {
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    const csvHeader = 'Library,PreVersion,PostVersion,State,Phase,OriginalMatchedClients,TargetUpdatedClients,PostUpdateMatchedClients\n';

    const writeCsv = (stats: ExecutionStat[], type: string) => {
      if (stats.length === 0) return;
      const csvPath = path.join(CONFIG.RESULT_BASE_DIR, dateStr, `analysis_summary_${type}_${safeDateStr}.csv`);
      const csvRows = stats.map(stat =>
        `${stat.library},${stat.preVersion},${stat.postVersion},${stat.state},${stat.phase},${stat.originalMatchedClients},${stat.targetUpdatedClients},${stat.postUpdateMatchedClients}`
      ).join('\n');
      fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf8');
      console.log(`\n[Done] Summary CSV (${type}) generated: ${csvPath}`);
    };

    writeCsv(executionStats, 'all');
  } else {
    console.log("\n[Exit] No detection targets were processed.");
  }

  console.log(`\n=== All Tasks Completed ===`);
})();