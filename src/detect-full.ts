// detect-full.ts
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { detectByPattern } from "../R-BC/src/core/detectByPattern";

import StatusBar from "./utils/statusBar";
import targetCommits from "./analysis/targetCommits";
import OutputJson from "./utils/output_json";
import GetAllFiles from "./utils/getAllFiles";
import GetMatchedClients from './utils/getMatchedClients';

import { ExtractFunctionCallsResult, ExtendedDetectionOutput } from "./types/RbcTypes";
import { TargetUpdate, ExecutionStat, ClientTrack, ExcludedClient } from "./types/AnalysisTypes";

// ==========================================
// INPUT: 実行設定
// ==========================================
const CONFIG = {
  CLONE_SUMMARY_CSV: '../output/v2/versionData/2026-04-26-01-52-52-all/valid_clone_summary.csv',
  VERSION_DATA_DIR: '../output/v2/versionData/2026-04-26-01-52-52-all',
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/2026-04-14-11-23-05-all',
  
  SOURCE_CLIENT_REPOS: '../clonedata/clientRepos',
  BASE_CLONE_DIR: '../clonedata/analysis_temp_repos',
  
  RESULT_BASE_DIR: '../output/v2/specificData',
  STATES: ['success', 'failure'] as const,
  MAX_RELEASES_TO_TRACK: 1,

  DEBUG_MODE: false
};

StatusBar.init();

interface ExtendedExecutionStat extends ExecutionStat {
  rbcPatternCountAll: number;
  rbcPatternCountSuccess: number;
  rbcPatternCountFailure: number;
}

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
  console.log(`\n[DEBUG: 1] Script Started.`);
  console.log(`[Init] Checking clone summary CSV: ${CONFIG.CLONE_SUMMARY_CSV}`);

  if (!fs.existsSync(CONFIG.CLONE_SUMMARY_CSV)) {
    const autoPath = path.join(CONFIG.VERSION_DATA_DIR, 'valid_clone_summary.csv');
    if (fs.existsSync(autoPath)) {
      CONFIG.CLONE_SUMMARY_CSV = autoPath;
      console.log(`[DEBUG: 1.5] Auto-corrected CSV path to: ${autoPath}`);
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

  let taskList = allTasks.filter(t => t.SuccessCloned > 0 || t.FailureCloned > 0);

  if (CONFIG.DEBUG_MODE) {
    taskList = taskList.filter(t => t.libName === "acorn");
  }

  if (taskList.length === 0) {
    console.log(`[Exit] No tasks to process.`);
    StatusBar.finish();
    return;
  }

  console.log(`[DEBUG: 2] Loaded ${taskList.length} tasks from CSV.`);

  // LOOK: ここにあった「全ファイルスキャン (GetAllFiles.getRecursively)」を削除しました。
  // 代わりにループの中でピンポイントでディレクトリを探します。

  const dateStr = OutputJson.formatDateTime(new Date());
  const summaryOutDir = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'specific-commits');
  OutputJson.createDir(summaryOutDir);

  const executionStats: ExtendedExecutionStat[] = [];
  const allClientTracks: ClientTrack[] = [];
  const allExcludedClients: ExcludedClient[] = [];
  const totalSteps = taskList.length * CONFIG.STATES.length;
  let currentStep = 0;

  console.log(`[DEBUG: 3] Entering Main Task Loop.`);

  for (const task of taskList) {
    const { libName, preVersion, postVersion } = task;

    if (!libName || !postVersion) continue;

    const verKey = postVersion.replace(/[^a-zA-Z0-9]/g, '');

    for (const targetState of CONFIG.STATES) {
      currentStep++;
      const progressPercent = ((currentStep / totalSteps) * 100).toFixed(1);

      StatusBar.update(`⏳ [${currentStep}/${totalSteps} (${progressPercent}%)] Processing: ${libName} (${targetState})`);

      const recordEmptyStats = (rAll: number = 0, rSuc: number = 0, rFail: number = 0) => {
        const phases = ['update'];
        for (let i = 0; i < Math.min(3, CONFIG.MAX_RELEASES_TO_TRACK); i++) {
          phases.push(`release_${i + 1}`);
        }
        phases.forEach(phaseName => {
          executionStats.push({
            library: libName, preVersion, postVersion, state: targetState, phase: phaseName,
            rbcTotalPatternCount: 0,
            rbcPatternCountAll: rAll, rbcPatternCountSuccess: rSuc, rbcPatternCountFailure: rFail,
            originalMatchedClients: 0, targetUpdatedClients: 0, activeAnalyzed: 0,
            notFixed_PatternDetected: 0, fixed_ImplementationChanged: 0,
            downgraded: 0, noRelease: 0, unknownError: 0
          });
        });
      };

      const clientCountInCsv = targetState === 'success' ? task.SuccessCloned : task.FailureCloned;
      if (clientCountInCsv <= 0) {
        recordEmptyStats();
        continue;
      }

      const stateDataDir = path.join(CONFIG.VERSION_DATA_DIR, targetState, `${libName}-${postVersion}`);
      if (!fs.existsSync(stateDataDir)) {
        recordEmptyStats();
        continue;
      }

      const historyFiles = fs.readdirSync(stateDataDir);
      const historyFileName = historyFiles.find(f => f.startsWith(`version_history-${targetState}`) && f.endsWith('.json'));
      if (!historyFileName) {
        recordEmptyStats();
        continue;
      }
      const targetHistoryPath = path.join(stateDataDir, historyFileName);

      // =========================================================================
      // LOOK: フリーズ解消の肝。全件スキャンをやめ、対象のパスを直接指定して存在確認。
      // =========================================================================
      const rbcTargetDir = path.resolve(CONFIG.RBC_DATA_ROOT, `${libName}_${verKey}`);
      
      if (!fs.existsSync(rbcTargetDir)) {
        recordEmptyStats();
        continue;
      }

      // 対象ディレクトリの中だけスキャンするので一瞬で終わります。
      const localRbcFiles = await GetAllFiles.getRecursively(rbcTargetDir);

      const successDetectFile = localRbcFiles.find(f => f.endsWith('success_detect.json'));
      const failureDetectFile = localRbcFiles.find(f => f.endsWith('failure_detect.json'));
      const patternFile = localRbcFiles.find(f => f.includes('detectpatternlist.json') || f.includes('patternList.json'));

      let rbcPatternCountSuccess = 0;
      let rbcPatternCountFailure = 0;

      if (successDetectFile) {
        try {
          const data = JSON.parse(fs.readFileSync(successDetectFile, 'utf-8')) as ExtendedDetectionOutput;
          rbcPatternCountSuccess = Number(data.totalClients) || 0;
        } catch (e) { }
      }
      if (failureDetectFile) {
        try {
          const data = JSON.parse(fs.readFileSync(failureDetectFile, 'utf-8')) as ExtendedDetectionOutput;
          rbcPatternCountFailure = Number(data.totalClients) || 0;
        } catch (e) { }
      }
      const rbcPatternCountAll = rbcPatternCountSuccess + rbcPatternCountFailure;

      const currentDetectFile = targetState === 'success' ? successDetectFile : failureDetectFile;
      let rbcMatchedClients: string[] = [];
      if (currentDetectFile) {
        try {
          const data = JSON.parse(fs.readFileSync(currentDetectFile, 'utf-8')) as ExtendedDetectionOutput;
          if (Array.isArray(data.detectedClients)) {
            rbcMatchedClients = data.detectedClients;
          }
        } catch (e) { }
      }

      if (!currentDetectFile || !patternFile) {
        recordEmptyStats(rbcPatternCountAll, rbcPatternCountSuccess, rbcPatternCountFailure);
        continue;
      }

      const filteredHistory = GetMatchedClients.filterByMode(targetHistoryPath, rbcMatchedClients);
      const rawTargets = targetCommits.get(filteredHistory, libName, postVersion);

      const uniqueTargetsMap = new Map<string, any>();
      for (const t of rawTargets) {
        if (!uniqueTargetsMap.has(t.C_client)) {
          uniqueTargetsMap.set(t.C_client, t);
        }
      }
      const targets = Array.from(uniqueTargetsMap.values());

      const targetedClientNames = new Set(targets.map(t => t.C_client));
      for (const c of rbcMatchedClients) {
        if (!targetedClientNames.has(c)) {
          allExcludedClients.push({
            Library: libName, Client: c, State: targetState,
            PreVersion: preVersion, PostVersion: postVersion
          });
        }
      }

      if (targets.length === 0) {
        recordEmptyStats(rbcPatternCountAll, rbcPatternCountSuccess, rbcPatternCountFailure);
        continue;
      }

      const commitLogPath = path.resolve(summaryOutDir, `${libName}-${postVersion}_${targetState}_list.json`);
      const exportTargets = targets.map((t: any) => ({
        client: t.C_client,
        libVersion: t.L_postLibVersion,
        commitID: t.C_commitID,
        tagCommitID: t.C_tagCommitID
      }));
      fs.writeFileSync(commitLogPath, JSON.stringify(exportTargets, null, 2));

      const patternModeFlag = patternFile.includes('detectpatternlist.json') ? 0 : 1;
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

      const clientStatus = new Map<string, 'active' | 'downgraded' | 'no_release' | 'unknown_error'>();
      const clientTracks = new Map<string, ClientTrack>();

      targets.forEach((t: any) => {
        clientStatus.set(t.C_client, 'active');
        clientTracks.set(t.C_client, {
          Library: libName, Client: t.C_client, State: targetState,
          PreVersion: preVersion, PostVersion: postVersion,
          Update_LibVer: '-', Update_Status: '-',
          R1_LibVer: '-', R1_Status: '-',
          R2_LibVer: '-', R2_Status: '-',
          R3_LibVer: '-', R3_Status: '-'
        });
      });

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
        let unknownErrorCount = 0;

        for (const item of targets) {
          const track = clientTracks.get(item.C_client)!;
          let currentStatus = clientStatus.get(item.C_client);

          let targetHash = "";
          let currentLibVer = postVersion;

          if (phaseIndex === -1) {
            targetHash = item.C_commitID;
            currentLibVer = item.L_postLibVersion || postVersion;
          } else {
            const clientData = filteredHistory.find((c: any) => c.C_client === item.C_client);
            const ver = clientData?.verList?.find((v: any) => v.C_commitID === item.C_commitID);
            const fallback = (ver?.C_tagCommitID && ver.C_tagCommitID !== 'no-subsequent-release')
              ? [{ C_tagCommitID: ver.C_tagCommitID, L_libVersion: ver.L_libVersion || postVersion }] : [];
            const releases = ver?.C_releases || fallback;
            const release = releases[phaseIndex];

            if (!release || !release.C_tagCommitID || release.C_tagCommitID === 'no-subsequent-release') {
              currentStatus = 'no_release';
              clientStatus.set(item.C_client, 'no_release');
            } else {
              currentLibVer = release.L_libVersion;
              targetHash = release.C_tagCommitID;
            }
          }

          if (currentStatus === 'active') {
            if (!currentLibVer || currentLibVer === "unknown" || currentLibVer === "not_found") {
              currentStatus = 'unknown_error';
              clientStatus.set(item.C_client, 'unknown_error');
            } else if (isDowngraded(currentLibVer, postVersion)) {
              currentStatus = 'downgraded';
              clientStatus.set(item.C_client, 'downgraded');
            } else if (!targetHash) {
              currentStatus = 'no_release';
              clientStatus.set(item.C_client, 'no_release');
            }
          }

          if (phaseName === 'update') track.Update_LibVer = currentLibVer || '-';
          if (phaseName === 'release_1') track.R1_LibVer = currentLibVer || '-';
          if (phaseName === 'release_2') track.R2_LibVer = currentLibVer || '-';
          if (phaseName === 'release_3') track.R3_LibVer = currentLibVer || '-';

          if (currentStatus !== 'active') {
            if (currentStatus === 'downgraded') downgradeCount++;
            if (currentStatus === 'no_release') noReleaseCount++;
            if (currentStatus === 'unknown_error') unknownErrorCount++;
            continue;
          }

          activeAnalyzedCount++;
          // 修正箇所: clientRepos 直下の libName/clientName を参照するように構造をフラット化
          const sourcePath = path.resolve(CONFIG.SOURCE_CLIENT_REPOS, libName, item.C_client);
          const destPath = path.resolve(absCloneDir, item.C_client);

          try {
            if (!fs.existsSync(sourcePath)) {
               // ログ出力: 見つからない場合にどこのパスを探したかを表示
               continue;
            }
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.cpSync(sourcePath, destPath, { recursive: true });
            execSync(`git -C "${destPath}" checkout -f ${targetHash}`, { stdio: 'ignore' });
            cloneSuccessCount++;
          } catch (err) { }
        }

        let detectedClientsCount = 0;
        const detectedClients = new Set<string>();

        if (cloneSuccessCount > 0) {

          await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, patternModeFlag);

          const outputFiles = fs.readdirSync(absOutDir).filter(f => f.endsWith('.json'));
          for (const file of outputFiles) {
            const content = fs.readFileSync(path.join(absOutDir, file), 'utf-8');
            for (const item of targets) {
              if (content.includes(`"${item.C_client}"`) || content.includes(item.C_client)) {
                detectedClients.add(item.C_client);
              }
            }
          }

          detectedClientsCount = detectedClients.size;

          for (const file of outputFiles) {
            const ext = path.extname(file);
            const base = path.basename(file, ext);
            fs.renameSync(path.join(absOutDir, file), path.join(absOutDir, `${base}_${detectedClientsCount}${ext}`));
          }
        }

        for (const item of targets) {
          const track = clientTracks.get(item.C_client)!;
          const currentStatus = clientStatus.get(item.C_client);

          let statusToRecord = "-";
          if (currentStatus === 'downgraded') statusToRecord = 'Downgraded (Rolled Back)';
          else if (currentStatus === 'no_release') statusToRecord = 'No Release';
          else if (currentStatus === 'unknown_error') statusToRecord = 'Unknown Error';
          else if (currentStatus === 'active') {
            const destPath = path.resolve(absCloneDir, item.C_client);
            if (!fs.existsSync(destPath)) {
              statusToRecord = 'Clone Failed';
            } else if (detectedClients.has(item.C_client)) {
              statusToRecord = 'Not Fixed (Pattern Detected)';
            } else {
              statusToRecord = 'Fixed (Impl Changed)';
            }
          }

          if (phaseName === 'update') track.Update_Status = statusToRecord;
          if (phaseName === 'release_1') track.R1_Status = statusToRecord;
          if (phaseName === 'release_2') track.R2_Status = statusToRecord;
          if (phaseName === 'release_3') track.R3_Status = statusToRecord;
        }

        const implementationChangedCount = activeAnalyzedCount - detectedClientsCount;

        executionStats.push({
          library: libName, preVersion, postVersion, state: targetState, phase: phaseName,
          rbcTotalPatternCount: 0,
          rbcPatternCountAll,
          rbcPatternCountSuccess,
          rbcPatternCountFailure,
          originalMatchedClients: targets.length,
          targetUpdatedClients: targets.length,
          activeAnalyzed: activeAnalyzedCount,
          notFixed_PatternDetected: detectedClientsCount,
          fixed_ImplementationChanged: Math.max(0, implementationChangedCount),
          downgraded: downgradeCount, noRelease: noReleaseCount, unknownError: unknownErrorCount
        });

        // 即時削除
        if (fs.existsSync(absCloneDir)) {
          fs.rmSync(absCloneDir, { recursive: true, force: true });
        }
        console.log(`[DEBUG]   -> Phase: ${phaseName} finished.`);
      };

      await runAnalysis('update', -1);
      for (let i = 0; i < Math.min(3, CONFIG.MAX_RELEASES_TO_TRACK); i++) {
        await runAnalysis(`release_${i + 1}`, i);
      }

      for (const track of clientTracks.values()) {
        allClientTracks.push(track);
      }

      if (fs.existsSync(baseClonePath)) {
        fs.rmSync(baseClonePath, { recursive: true, force: true });
      }
    }
  }

  StatusBar.finish();

  if (executionStats.length > 0 || allExcludedClients.length > 0) {
    const safeDateStr = dateStr.replace(/[: ]/g, '_');

    if (executionStats.length > 0) {
      const csvHeader = 'Library,PreVersion,PostVersion,State,Phase,RBC_TotalPatternCount,OriginalMatchedClients,TargetUpdatedClients,ActiveAnalyzed,NotFixed_PatternDetected,Fixed_ImplementationChanged,Downgraded,NoRelease,UnknownError\n';

      const writeCsv = (stats: ExtendedExecutionStat[], type: 'all' | 'success' | 'failure') => {
        if (stats.length === 0) return;
        const csvPath = path.join(CONFIG.RESULT_BASE_DIR, dateStr, `analysis_summary_${type}_${safeDateStr}.csv`);
        const csvRows = stats.map(stat => {
          let targetRbcCount = stat.rbcPatternCountAll;
          if (type === 'success') targetRbcCount = stat.rbcPatternCountSuccess;
          else if (type === 'failure') targetRbcCount = stat.rbcPatternCountFailure;

          return `${stat.library},${stat.preVersion},${stat.postVersion},${stat.state},${stat.phase},${targetRbcCount},${stat.originalMatchedClients},${stat.targetUpdatedClients},${stat.activeAnalyzed},${stat.notFixed_PatternDetected},${stat.fixed_ImplementationChanged},${stat.downgraded},${stat.noRelease},${stat.unknownError}`;
        }).join('\n');
        fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf8');
      };

      writeCsv(executionStats, 'all');
      writeCsv(executionStats.filter(s => s.state === 'failure'), 'failure');
      writeCsv(executionStats.filter(s => s.state === 'success'), 'success');
    }

    if (allClientTracks.length > 0) {
      const detailedHeader = 'Library,Client,State,PreVersion,PostVersion,Update_LibVer,Update_Status,R1_LibVer,R1_Status,R2_LibVer,R2_Status,R3_LibVer,R3_Status\n';
      const detailedRows = allClientTracks.map(t =>
        `${t.Library},${t.Client},${t.State},${t.PreVersion},${t.PostVersion},${t.Update_LibVer},${t.Update_Status},${t.R1_LibVer},${t.R1_Status},${t.R2_LibVer},${t.R2_Status},${t.R3_LibVer},${t.R3_Status}`
      ).join('\n');

      const detailedCsvPath = path.join(CONFIG.RESULT_BASE_DIR, dateStr, `client_detailed_tracking_${safeDateStr}.csv`);
      fs.writeFileSync(detailedCsvPath, detailedHeader + detailedRows, 'utf8');
    }

    if (allExcludedClients.length > 0) {
      const excludedHeader = 'Library,Client,State,PreVersion,PostVersion\n';
      const excludedRows = allExcludedClients.map(e =>
        `${e.Library},${e.Client},${e.State},${e.PreVersion},${e.PostVersion}`
      ).join('\n');

      const excludedCsvPath = path.join(CONFIG.RESULT_BASE_DIR, dateStr, `excluded_clients_summary_${safeDateStr}.csv`);
      fs.writeFileSync(excludedCsvPath, excludedHeader + excludedRows, 'utf8');
    }

  }
  console.log(`\n[DEBUG] Script completed entirely.`);
})();