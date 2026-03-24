import fs from "fs";
import path from "path";
import readline from "readline";
import { execSync } from "child_process";
import { detectByPattern } from "../R-BC/src/core/detectByPattern";
import { ExtractFunctionCallsResult } from "../R-BC/src/types/ExtractFunctionCallsResult";

import { Client_Ver, specificCommit } from "./types/VersionCommits";
import StatusBar from "./utils/statusBar";
import GetTargetCommits from "./utils/targetCommits";
import ParseCloneSummary from "./utils/cloneSummary";
import OutputJson from "./utils/output_json";
import GetAllFiles from "./utils/getAllFiles";
import GetMatchedClients from './utils/getMatchedClients';

// ==========================================
// INPUT: 実行設定 (ここのパス環境に合わせて書き換えてください)
// ==========================================
const CONFIG = {
  // 1. verData(抽出処理) が出力した CSV のパス (解析対象の特定に使用)
  CLONE_SUMMARY_CSV: '../output/cloneResult/2026-03-16-17-00-35/clone_summary.csv',

  // 2. verData が出力した履歴データが格納されているディレクトリ
  VERSION_DATA_DIR: '../output/versionData/2026-03-16-17-00-35-all',

  // 3. パターンデータ (R-BCの結果) が格納されているディレクトリ
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/2026-03-16-12-19-37-all',

  // 4.verData(抽出処理) がクローンしたクライアントリポジトリの格納先
  SOURCE_CLIENT_REPOS: '../clonedata/repos/clientRepos_all',

  // 5. 解析実行時に一時的にリポジトリをコピー＆チェックアウトする作業ディレクトリ
  BASE_CLONE_DIR: '../clonedata/repos/analysis_temp_repos',

  // 6. detectByPattern の解析結果および集計CSVを出力するディレクトリ
  RESULT_BASE_DIR: '../output/specificData',

  // 解析対象とする状態
  STATES: ['success', 'failure']
};
// ==========================================

// ステータスバーの初期化
StatusBar.init();

interface ExecutionStat {
  library: string;
  preVersion: string;
  postVersion: string;
  state: string;
  phase: string;
  targetClientsCount: number;
  successfullyClonedCount: number;
  detectedClientsCount: number;
}

(async () => {
  console.log(`[Init] Reading clone summary CSV from: ${CONFIG.CLONE_SUMMARY_CSV}`);
  if (!fs.existsSync(CONFIG.CLONE_SUMMARY_CSV)) {
    console.error(`[Error] CSV file not found! Please check CONFIG.CLONE_SUMMARY_CSV.`);
    StatusBar.finish();
    return;
  }

  const taskList = ParseCloneSummary.parse(CONFIG.CLONE_SUMMARY_CSV);
  console.log(`[Init] Found ${taskList.length} valid tasks to analyze.`);

  if (taskList.length === 0) {
    console.log(`[Exit] No successful tasks found in CSV.`);
    StatusBar.finish();
    return;
  }

  console.log(`[Init] Scanning RBC Pattern files...`);
  const rbcFiles = await GetAllFiles.getRecursively(CONFIG.RBC_DATA_ROOT);

  const dateStr = OutputJson.formatDateTime(new Date());
  const summaryOutDir = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'specific-commits');
  OutputJson.createDir(summaryOutDir);

  const executionStats: ExecutionStat[] = [];
  const totalSteps = taskList.length * CONFIG.STATES.length;
  let currentStep = 0;

  for (const task of taskList) {
    const { libName, preVersion, postVersion } = task;
    const verKey = postVersion.replace(/[\.-]/g, '');

    for (const targetState of CONFIG.STATES) {
      currentStep++;
      const progressPercent = ((currentStep / totalSteps) * 100).toFixed(1);

      StatusBar.update(`⏳ [Progress: ${currentStep}/${totalSteps} (${progressPercent}%)] Processing: ${libName} ${preVersion} -> ${postVersion} (${targetState})`);

      const stateDataDir = path.join(CONFIG.VERSION_DATA_DIR, targetState, `${libName}-${postVersion}`);
      if (!fs.existsSync(stateDataDir)) continue;

      const historyFiles = fs.readdirSync(stateDataDir);
      const historyFileName = historyFiles.find(f => f.startsWith(`version_history-${targetState}`) && f.endsWith('.json'));
      if (!historyFileName) continue;

      const targetHistoryPath = path.join(stateDataDir, historyFileName);

      const rbcTargetDirBase = rbcFiles.find(f => f.includes(`${libName}_${verKey}`));
      if (!rbcTargetDirBase) continue;
      const rbcTargetDir = rbcTargetDirBase.split(`${libName}_${verKey}`)[0] + `${libName}_${verKey}`;

      const matchFilePath = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('matchResults.json') && f.includes(targetState));
      const detectPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('detectpatternlist.json') && f.endsWith('.json'));
      const fallbackPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('patternList.json') && f.endsWith('.json'));
      const patternFile = detectPatternFile || fallbackPatternFile;

      if (!matchFilePath || !patternFile) continue;

      const patternModeFlag = detectPatternFile ? 0 : 1;

      const filteredHistory = GetMatchedClients.get(matchFilePath, targetHistoryPath);
      const targets = GetTargetCommits.get(filteredHistory, libName, postVersion);

      if (targets.length === 0) continue;

      const commitLogPath = path.resolve(summaryOutDir, `${libName}-${postVersion}_${targetState}_list.json`);
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

      const baseFolderName = `${libName}-${postVersion}_${targetState}`;
      const baseClonePath = path.resolve(CONFIG.BASE_CLONE_DIR, baseFolderName);
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

          const sourcePath = path.resolve(CONFIG.SOURCE_CLIENT_REPOS, libName, verKey, targetState, item.C_client);
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

          // ==========================================
          // 出力された JSON ファイル名の末尾に件数を付与する
          // ==========================================
          const outputFiles = fs.readdirSync(absOutDir).filter(f => f.endsWith('.json'));
          for (const file of outputFiles) {
            const oldPath = path.join(absOutDir, file);
            const ext = path.extname(file);
            const base = path.basename(file, ext);
            // 例: update_detect.json -> update_detect_5.json
            const newPath = path.join(absOutDir, `${base}_${detectedCount}${ext}`);
            fs.renameSync(oldPath, newPath);
          }
        }

        executionStats.push({
          library: libName,
          preVersion: preVersion,
          postVersion: postVersion,
          state: targetState,
          phase: type,
          targetClientsCount: targets.length,
          successfullyClonedCount: successCount,
          detectedClientsCount: detectedCount
        });
      };

      await runAnalysis('update');
      await runAnalysis('release');
    }
  }

  StatusBar.finish();

  if (executionStats.length > 0) {
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    const csvHeader = 'Library,PreVersion,PostVersion,State,Phase,TargetClientsCount,SuccessfullyClonedCount,DetectedClientsCount\n';

    const writeCsv = (stats: ExecutionStat[], type: string) => {
      if (stats.length === 0) return;
      const csvPath = path.join(CONFIG.RESULT_BASE_DIR, dateStr, `analysis_summary_${type}_${safeDateStr}.csv`);
      const csvRows = stats.map(stat =>
        `${stat.library},${stat.preVersion},${stat.postVersion},${stat.state},${stat.phase},${stat.targetClientsCount},${stat.successfullyClonedCount},${stat.detectedClientsCount}`
      ).join('\n');
      fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf8');
      console.log(`\n[Done] Analysis Summary CSV (${type}) generated at:\n => ${csvPath}`);
    };

    writeCsv(executionStats, 'all');
    writeCsv(executionStats.filter(s => s.state === 'failure'), 'failure');
    writeCsv(executionStats.filter(s => s.state === 'success'), 'success');

  } else {
    console.log("\n[Exit] No detection targets were processed.");
  }

  console.log(`\n=== All Tasks Completed (100%) ===`);
})();