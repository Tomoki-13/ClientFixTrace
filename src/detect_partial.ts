// detect_partial.ts
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { detectByPattern } from "../R-BC/src/core/detectByPattern";

import StatusBar from "./utils/statusBar";
import TargetCommits from "./analysis/targetCommits";
import OutputJson from "./utils/output_json";
import GetAllFiles from "./utils/getAllFiles";
import GetMatchedClients from './utils/getMatchedClients';

import { ExtractFunctionCallsResult, ExtendedDetectionOutput } from "./types/RbcTypes";

// ==========================================
// INPUT: 実行設定 (特定のライブラリを調べる立ち位置を維持)
// ==========================================
const CONFIG = {
  // 分析対象タスクのリスト
  TASK_LIST_PATH: '../datasets/mydata/mydata.json',
  // 抽出された履歴データ(version_history-*.json)の格納先
  HISTORY_BASE_DIR: '../datasets/analysis_target/current/2026-02-24-08-48-48',
  // R-BCによる事前のパターン検出結果(detect.json等)の格納先
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/fulldataSample',
  // 大元のクローンキャッシュ（永続保存）
  SOURCE_CLIENT_REPOS: '../clientRepos',
  // 一時的なチェックアウト作業用ディレクトリ（処理後に自動削除）
  UPDATE_CLIENT_BASE: '../client_update_temp',
  // 調査対象とするビルド/テストの状態
  STATE: 'success',
  // 解析結果(JSON)および集計サマリー(CSV)の出力先
  RESULT_BASE_DIR: '../output/specificData'
};

StatusBar.init();

interface PartialExecutionStat {
  library: string;
  preVersion: string;
  postVersion: string;
  state: string;
  phase: string;
  originalMatchedClients: number;
  targetUpdatedClients: number;
  postUpdateMatchedClients: number;
}

(async () => {
  if (!fs.existsSync(CONFIG.TASK_LIST_PATH)) {
    console.error(`[Error] ${CONFIG.TASK_LIST_PATH} is required for Partial mode.`);
    return;
  }

  // 型エラー対応：パース結果を明示的に配列としてキャスト
  const fileContent = fs.readFileSync(CONFIG.TASK_LIST_PATH, 'utf-8');
  const taskList = JSON.parse(fileContent) as { libName: string; preVersion?: string; postVersion: string }[];

  const historyFiles = await GetAllFiles.getRecursively(CONFIG.HISTORY_BASE_DIR);
  const rbcFiles = await GetAllFiles.getRecursively(CONFIG.RBC_DATA_ROOT);

  const dateStr = OutputJson.formatDateTime(new Date());

  const summaryOutDir = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'specific-commits');
  OutputJson.createDir(summaryOutDir);

  const executionStats: PartialExecutionStat[] = [];
  const totalSteps = taskList.length;
  let currentStep = 0;

  for (const task of taskList) {
    currentStep++;
    const { libName, postVersion } = task;
    const preVersion = task.preVersion || 'unknown';

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

    const detectFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.endsWith(`${CONFIG.STATE}_detect.json`));
    const detectPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('detectpatternlist.json'));
    const fallbackPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('patternList.json'));

    const patternFile = detectPatternFile || fallbackPatternFile;

    if (!detectFile || !patternFile) continue;

    let rbcMatchedClients: string[] = [];
    try {
      const data = JSON.parse(fs.readFileSync(detectFile, 'utf-8')) as ExtendedDetectionOutput;
      if (Array.isArray(data.detectedClients)) {
        rbcMatchedClients = data.detectedClients;
      }
    } catch (e) {}

    const patternModeFlag = detectPatternFile ? 0 : 1;

    console.log(`\n--- [Analysis] ${libName}-${postVersion} ---`);

    const filteredHistory = GetMatchedClients.filterByMode(targetHistoryPath, rbcMatchedClients);
    const rawTargets = TargetCommits.get(filteredHistory, libName, postVersion);

    const uniqueTargetsMap = new Map<string, any>();
    for (const t of rawTargets) {
      if (!uniqueTargetsMap.has(t.C_client)) {
        uniqueTargetsMap.set(t.C_client, t);
      }
    }
    const targets = Array.from(uniqueTargetsMap.values());

    if (targets.length === 0) {
      console.log(`  [Skip] No valid updated clients found.`);
      continue;
    }

    const commitLogPath = path.resolve(summaryOutDir, `${libName}-${postVersion}_${CONFIG.STATE}_list.json`);

    const exportTargets = targets.map((t: { C_client: string; L_postLibVersion: string; C_commitID: string; C_tagCommitID: string }) => ({
      client: t.C_client,
      libVersion: t.L_postLibVersion,
      commitID: t.C_commitID,
      tagCommitID: t.C_tagCommitID
    }));
    fs.writeFileSync(commitLogPath, JSON.stringify(exportTargets, null, 2));

    const patternContent = fs.readFileSync(patternFile, 'utf-8');
    const patternData = JSON.parse(patternContent) as any;

    const rawPatterns: any[] = (patternData && patternData.patterns)
      ? patternData.patterns.map((p: any) => p.pattern)
      : (patternData || []);

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

        const sourcePath = path.resolve(CONFIG.SOURCE_CLIENT_REPOS, libName, item.C_client);
        const destPath = path.resolve(absCloneDir, item.C_client);

        try {
          if (!fs.existsSync(sourcePath)) continue;
          
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.cpSync(sourcePath, destPath, { recursive: true });
          execSync(`git -C "${destPath}" checkout -f ${targetHash}`, { stdio: 'ignore' });
          successCount++;
        } catch (err) { }
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
        originalMatchedClients: rbcMatchedClients.length,
        targetUpdatedClients: targets.length,
        postUpdateMatchedClients: detectedCount
      });

      // ディスク容量節約のため、解析終了後の作業用ディレクトリを削除
      if (fs.existsSync(absCloneDir)) {
        fs.rmSync(absCloneDir, { recursive: true, force: true });
      }
    };

    await runAnalysis('update');
    await runAnalysis('release');

    if (fs.existsSync(baseClonePath)) {
      fs.rmSync(baseClonePath, { recursive: true, force: true });
    }
  }

  StatusBar.finish();

  if (executionStats.length > 0) {
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    const csvHeader = 'Library,PreVersion,PostVersion,State,Phase,OriginalMatchedClients,TargetUpdatedClients,PostUpdateMatchedClients\n';

    const writeCsv = (stats: PartialExecutionStat[], type: string) => {
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
})();