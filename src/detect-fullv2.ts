import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { detectByPattern } from "../R-BC/src/core/detectByPattern";
import { ExtractFunctionCallsResult } from "../R-BC/src/types/ExtractFunctionCallsResult";

import StatusBar from "./utils/statusBar";
import TargetCommits from "./analysis/targetCommits";
import OutputJson from "./utils/output_json";
import GetAllFiles from "./utils/getAllFiles";
import GetMatchedClients from './utils/getMatchedClients';

// CSV行データのマッピング用
interface TargetUpdate {
  libName: string;
  preVersion: string;
  postVersion: string;
  SuccessCloned: number;
  FailureCloned: number;
  Status: string;
}

// INPUT: 実行設定
const CONFIG = {
  CLONE_SUMMARY_CSV: '../datasets/analysis_target/verdata/2026-04-02-17-26-21-all/valid_clone_summary.csv',
  VERSION_DATA_DIR: '../output/v2/versionData/2026-04-22-14-29-19-full',
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/2026-04-14-11-23-05-all',
  SOURCE_CLIENT_REPOS: '../clonedata/repos/clientRepos_all',
  BASE_CLONE_DIR: '../clonedata/repos/analysis_temp_repos',
  RESULT_BASE_DIR: '../output/v2/specificData',
  STATES: ['success', 'failure'] as const
};

StatusBar.init();

// 集計結果の詳細な状態を区別するためのデータ構造
interface ExecutionStat {
  library: string;
  preVersion: string;
  postVersion: string;
  state: string;
  phase: string;
  originalMatchedClients: number;
  targetUpdatedClients: number;
  activeAnalyzed: number;
  notFixed_PatternDetected: number;
  fixed_ImplementationChanged: number;
  downgraded: number;
  noRelease: number;
}

// 対象バージョンより下がっているかを判定しダウングレードを検知する
function isDowngraded(currentVer: string, targetVer: string): boolean {
  if (!currentVer || currentVer === "not_found" || currentVer === "unknown") return false;
  const clean = (v: string) => v.replace(/^[^\d]+/, '').split('-')[0].split('.').map(Number);
  const c = clean(currentVer);
  const t = clean(targetVer);
  for (let i = 0; i < Math.max(c.length, t.length); i++) {
    const v1 = c[i] || 0;
    const v2 = t[i] || 0;
    if (v1 < v2) return true;
    if (v1 > v2) return false;
  }
  return false;
}

(async () => {
  console.log(`[Init] Checking clone summary CSV: ${CONFIG.CLONE_SUMMARY_CSV}`);

  if (!fs.existsSync(CONFIG.CLONE_SUMMARY_CSV)) {
    const autoPath = path.join(CONFIG.VERSION_DATA_DIR, 'valid_clone_summary.csv');
    if (fs.existsSync(autoPath)) {
      CONFIG.CLONE_SUMMARY_CSV = autoPath;
    } else {
      console.error(`[Error] CSV file not found!`);
      StatusBar.finish();
      return;
    }
  }

  const csvContent = fs.readFileSync(CONFIG.CLONE_SUMMARY_CSV, 'utf-8');
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  const allTasks: TargetUpdate[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length < 6) continue;
    allTasks.push({
      libName: cols[0],
      preVersion: cols[1],
      postVersion: cols[2],
      SuccessCloned: Number(cols[3]) || 0,
      FailureCloned: Number(cols[4]) || 0,
      Status: cols[5]
    });
  }

  const taskList = allTasks.filter(t => t.SuccessCloned > 0 || t.FailureCloned > 0);

  if (taskList.length === 0) {
    console.log(`[Exit] No tasks to process.`);
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

    if (!libName || !postVersion) continue;

    const verKey = postVersion.replace(/[^a-zA-Z0-9]/g, '');

    for (const targetState of CONFIG.STATES) {
      currentStep++;
      const progressPercent = ((currentStep / totalSteps) * 100).toFixed(1);

      const clientCountInCsv = targetState === 'success' ? task.SuccessCloned : task.FailureCloned;
      if (clientCountInCsv <= 0) continue;

      StatusBar.update(`⏳ [${currentStep}/${totalSteps} (${progressPercent}%)] Processing: ${libName} (${targetState})`);

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
      const patternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && (f.includes('detectpatternlist.json') || f.includes('patternList.json')));

      if (!matchFilePath || !patternFile) continue;

      const patternModeFlag = patternFile.includes('detectpatternlist.json') ? 0 : 1;

      const filteredHistory = GetMatchedClients.get(matchFilePath, targetHistoryPath);
      const targets = TargetCommits.get(filteredHistory, libName, postVersion);

      if (targets.length === 0) continue;

      const commitLogPath = path.resolve(summaryOutDir, `${libName}-${postVersion}_${targetState}_list.json`);
      // 型エラー回避：mapに渡す引数 't' の型を明示的に指定
      const exportTargets = targets.map((t: { C_client: string; L_postLibVersion: string; C_commitID: string; C_tagCommitID: string }) => ({
        client: t.C_client,
        libVersion: t.L_postLibVersion,
        commitID: t.C_commitID,
        tagCommitID: t.C_tagCommitID
      }));
      fs.writeFileSync(commitLogPath, JSON.stringify(exportTargets, null, 2));

      // パース時のnullエラーを回避するため安全にキャストしてパターンを抽出する
      const fileContent = fs.readFileSync(patternFile, 'utf-8');
      const patternData = JSON.parse(fileContent) as any;

      const rawPatterns: any[] = (patternData && patternData.patterns)
        ? patternData.patterns.map((p: any) => p.pattern)
        : (patternData || []);

      const patterns: ExtractFunctionCallsResult[][][] = rawPatterns.map((p: any[]) =>
        p.map((bg: any[]) => bg.flatMap(b => Array.isArray(b) ? b : [b]))
      );

      const baseFolderName = `${libName}-${postVersion}_${targetState}`;
      const baseClonePath = path.resolve(CONFIG.BASE_CLONE_DIR, baseFolderName);
      const baseResultPath = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'results', baseFolderName);

      if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
      OutputJson.createDir(baseClonePath);

      // クライアントごとの処理状態をフェーズ間で引き継ぐためのマップ
      const clientStatus = new Map<string, 'active' | 'downgraded' | 'no_release'>();
      targets.forEach((t: any) => clientStatus.set(t.C_client, 'active'));

      /**
       * 入力: phaseName (フェーズ名), phaseIndex (リリース履歴のインデックス)
       * 出力: クライアント状態に応じてスキップ/クローンを判断し検出を実行、結果を集計する
       */
      const runAnalysis = async (phaseName: string, phaseIndex: number) => {
        const absCloneDir = path.resolve(baseClonePath, phaseName);
        const absOutDir = path.resolve(baseResultPath, phaseName);
        const relativeCloneDir = path.relative(process.cwd(), absCloneDir);

        OutputJson.createDir(absCloneDir);
        OutputJson.createDir(absOutDir);

        let activeAnalyzedCount = 0;
        let cloneSuccessCount = 0;
        let downgradeCount = 0;
        let noReleaseCount = 0;

        for (const item of targets) {
          const currentStatus = clientStatus.get(item.C_client);

          // 以前のフェーズで処理不要と判定されたクライアントはそのままカウントを加算してスキップ
          if (currentStatus === 'downgraded') { downgradeCount++; continue; }
          if (currentStatus === 'no_release') { noReleaseCount++; continue; }

          let targetHash = "";

          if (phaseIndex === -1) {
            targetHash = item.C_commitID;
          } else {
            const clientData = filteredHistory.find((c: any) => c.C_client === item.C_client);
            const ver = clientData?.verList?.find((v: any) => v.C_commitID === item.C_commitID);

            const fallback = (ver?.C_tagCommitID && ver.C_tagCommitID !== 'no-subsequent-release')
              ? [{ C_tagCommitID: ver.C_tagCommitID, L_libVersion: ver.L_libVersion || postVersion }] : [];
            const releases = ver?.C_releases || fallback;

            const release = releases[phaseIndex];

            // 該当リリースが存在しない場合は以降のフェーズでもスキップ対象とする
            if (!release || !release.C_tagCommitID || release.C_tagCommitID === 'no-subsequent-release') {
              clientStatus.set(item.C_client, 'no_release');
              noReleaseCount++;
              continue;
            }

            // ダウングレードを検知した場合は以降のフェーズでもスキップ対象とする
            if (isDowngraded(release.L_libVersion, postVersion)) {
              clientStatus.set(item.C_client, 'downgraded');
              downgradeCount++;
              continue;
            }

            targetHash = release.C_tagCommitID;
          }

          if (!targetHash) {
            clientStatus.set(item.C_client, 'no_release');
            noReleaseCount++;
            continue;
          }

          activeAnalyzedCount++;

          const sourcePath = path.resolve(CONFIG.SOURCE_CLIENT_REPOS, libName, verKey, targetState, item.C_client);
          const destPath = path.resolve(absCloneDir, item.C_client);

          try {
            if (!fs.existsSync(sourcePath)) continue;
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.cpSync(sourcePath, destPath, { recursive: true });
            execSync(`git -C "${destPath}" checkout -f ${targetHash}`, { stdio: 'ignore' });
            cloneSuccessCount++;
          } catch (err) {
          }
        }

        let detectedCount = 0;
        if (cloneSuccessCount > 0) {
          const detectResult = await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, patternModeFlag);
          detectedCount = detectResult.totalClients;

          const outputFiles = fs.readdirSync(absOutDir).filter(f => f.endsWith('.json'));
          for (const file of outputFiles) {
            const ext = path.extname(file);
            const base = path.basename(file, ext);
            fs.renameSync(path.join(absOutDir, file), path.join(absOutDir, `${base}_${detectedCount}${ext}`));
          }
        }

        const implementationChangedCount = activeAnalyzedCount - detectedCount;

        executionStats.push({
          library: libName,
          preVersion: preVersion,
          postVersion: postVersion,
          state: targetState,
          phase: phaseName,
          originalMatchedClients: filteredHistory.length,
          targetUpdatedClients: targets.length,
          activeAnalyzed: activeAnalyzedCount,
          notFixed_PatternDetected: detectedCount,
          fixed_ImplementationChanged: Math.max(0, implementationChangedCount),
          downgraded: downgradeCount,
          noRelease: noReleaseCount
        });
      };

      // 4つのフェーズ（更新直後＋最大3リリース）を順次実行する
      await runAnalysis('update', -1);
      await runAnalysis('release_1', 0);
      await runAnalysis('release_2', 1);
      await runAnalysis('release_3', 2);
    }
  }

  StatusBar.finish();

  if (executionStats.length > 0) {
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    const csvHeader = 'Library,PreVersion,PostVersion,State,Phase,OriginalMatchedClients,TargetUpdatedClients,ActiveAnalyzed,NotFixed_PatternDetected,Fixed_ImplementationChanged,Downgraded,NoRelease\n';

    const writeCsv = (stats: ExecutionStat[], type: string) => {
      if (stats.length === 0) return;
      const csvPath = path.join(CONFIG.RESULT_BASE_DIR, dateStr, `analysis_summary_${type}_${safeDateStr}.csv`);
      const csvRows = stats.map(stat =>
        `${stat.library},${stat.preVersion},${stat.postVersion},${stat.state},${stat.phase},${stat.originalMatchedClients},${stat.targetUpdatedClients},${stat.activeAnalyzed},${stat.notFixed_PatternDetected},${stat.fixed_ImplementationChanged},${stat.downgraded},${stat.noRelease}`
      ).join('\n');
      fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf8');
      console.log(`\n[Done] Summary CSV (${type}) generated: ${csvPath}`);
    };

    writeCsv(executionStats, 'all');
    writeCsv(executionStats.filter(s => s.state === 'failure'), 'failure');
    writeCsv(executionStats.filter(s => s.state === 'success'), 'success');
  } else {
    console.log("\n[Exit] No detection targets were processed.");
  }
})();