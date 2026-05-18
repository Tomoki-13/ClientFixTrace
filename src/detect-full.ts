import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { detectByPattern } from "../R-BC/src/core/detectByPattern";

import StatusBar from "./utils/statusBar";
import targetCommits from "./analysis/targetCommits";
import OutputJson from "./utils/output_json";
import GetAllFiles from "./utils/getAllFiles";
import GetMatchedClients from './utils/getMatchedClients';

// 新しく作成したユーティリティをインポート
import VersionUtil from "./analysis/versionUtil";
import CsvHandler from "./utils/csvHandler";

import { ExtractFunctionCallsResult, ExtendedDetectionOutput } from "./types/RbcTypes";
import { TargetUpdate, ExecutionStat, ClientTrack, ExcludedClient } from "./types/AnalysisTypes";

// ==========================================
// INPUT: 実行設定
// ==========================================
const CONFIG = {
  // 抽出フェーズ（verHist）で出力された、正常にクローンできたライブラリとクライアントの対応表
  CLONE_SUMMARY_CSV: '../output/v2/versionData/2026-04-26-01-52-52-all/valid_clone_summary.csv',
  
  // 各ライブラリの履歴データ（version_history.json）が格納されているルートディレクトリ
  VERSION_DATA_DIR: '../output/v2/versionData/2026-04-26-01-52-52-all',
  
  // R-BCによる事前解析結果（抽出された破壊的変更パターンや初期検出結果）の格納先
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/2026-04-14-11-23-05-all',
  
  // クライアントリポジトリの原本（master/mainブランチ等）が格納されている永続キャッシュディレクトリ
  SOURCE_CLIENT_REPOS: '../clonedata/clientRepos',
  
  // 解析実行時に特定のコミットをチェックアウトするための、一時的な作業用ディレクトリ（解析後に削除される）
  BASE_CLONE_DIR: '../clonedata/analysis_temp_repos',
  
  // 最終的な解析サマリーCSVおよび詳細なトラッキングJSONの出力先
  RESULT_BASE_DIR: '../output/v2/specificData',
  
  // 解析対象とするクライアントの状態（テスト成功: success / テスト失敗: failure）
  STATES: ['success', 'failure'] as const,
  
  /**
   * バージョン更新後の後続リリースタグを最大何回まで追跡するかを指定
   * 値の範囲: 0 ~ 3 (0を指定した場合は 'update' フェーズのみ解析を実行する)
   */
  MAX_RELEASES_TO_TRACK: 3 
};

StatusBar.init();

interface ExtendedExecutionStat extends ExecutionStat {
  rbcPatternCountAll: number;
  rbcPatternCountSuccess: number;
  rbcPatternCountFailure: number;
}

(async () => {
  let cloneSummaryPath = CONFIG.CLONE_SUMMARY_CSV;
  if (!fs.existsSync(cloneSummaryPath)) {
    cloneSummaryPath = path.join(CONFIG.VERSION_DATA_DIR, 'valid_clone_summary.csv');
    if (!fs.existsSync(cloneSummaryPath)) {
      console.error(`[Error] CSV file not found!`);
      StatusBar.finish();
      return;
    }
  }

  // CsvHandlerを使用してタスクリストを読み込み・フィルタリング
  const taskList = CsvHandler.loadCloneSummary(cloneSummaryPath)
    .filter(t => t.SuccessCloned > 0 || t.FailureCloned > 0);

  if (taskList.length === 0) {
    StatusBar.finish();
    return;
  }

  const dateStr = OutputJson.formatDateTime(new Date());
  const summaryOutDir = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'specific-commits');
  OutputJson.createDir(summaryOutDir);

  const executionStats: ExtendedExecutionStat[] = [];
  const allClientTracks: ClientTrack[] = [];
  const allExcludedClients: ExcludedClient[] = [];
  const totalSteps = taskList.length * CONFIG.STATES.length;
  let currentStep = 0;

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
            targetUpdatedClients: 0, activeAnalyzed: 0,
            notFixed_PatternDetected: 0, fixed_ImplementationChanged: 0,
            downgraded: 0, noRelease: 0, unknownError: 0
          });
        });
      };

      const clientCountInCsv = targetState === 'success' ? task.SuccessCloned : task.FailureCloned;
      if (clientCountInCsv <= 0) continue;

      const stateDataDir = path.join(CONFIG.VERSION_DATA_DIR, targetState, `${libName}-${postVersion}`);
      if (!fs.existsSync(stateDataDir)) continue;

      const historyFiles = fs.readdirSync(stateDataDir);
      const historyFileName = historyFiles.find((f: string) => f.startsWith(`version_history-${targetState}`) && f.endsWith('.json'));
      if (!historyFileName) continue;
      
      const targetHistoryPath = path.join(stateDataDir, historyFileName);
      const rbcTargetDir = path.resolve(CONFIG.RBC_DATA_ROOT, `${libName}_${verKey}`);
      if (!fs.existsSync(rbcTargetDir)) continue;

      const localRbcFiles = await GetAllFiles.getRecursively(rbcTargetDir);
      const successDetectFile = localRbcFiles.find(f => f.endsWith('success_detect.json'));
      const failureDetectFile = localRbcFiles.find(f => f.endsWith('failure_detect.json'));
      const patternFile = localRbcFiles.find(f => f.includes('detectpatternlist.json') || f.includes('patternList.json'));

      if (!patternFile) continue;
      const currentDetectFile = targetState === 'success' ? successDetectFile : failureDetectFile;
      if (!currentDetectFile) continue;

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

      if (rbcPatternCountAll === 0) continue;

      let rbcMatchedClients: string[] = [];
      try {
        const data = JSON.parse(fs.readFileSync(currentDetectFile, 'utf-8')) as ExtendedDetectionOutput;
        if (Array.isArray(data.detectedClients)) {
          rbcMatchedClients = data.detectedClients;
        }
      } catch (e) { }

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
      const rawPatterns: any[] = (patternData && patternData.patterns) ? patternData.patterns.map((p: any) => p.pattern) : (patternData || []);
      const patterns: ExtractFunctionCallsResult[][][] = rawPatterns.map((p: any[]) => p.map((bg: any[]) => bg.flatMap(b => Array.isArray(b) ? b : [b])));

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
            
            let releases: any[] = [];
            if (ver?.C_releases && Array.isArray(ver.C_releases) && ver.C_releases.length > 0) {
              releases = ver.C_releases;
            } else if (ver?.C_tagCommitID && ver.C_tagCommitID !== 'no-subsequent-release') {
              releases = [{ C_tagCommitID: ver.C_tagCommitID, L_libVersion: ver.L_libVersion || postVersion }];
            }
            
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
            } else if (VersionUtil.isDowngraded(currentLibVer, postVersion)) {
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
          
          let sourcePath = path.resolve(CONFIG.SOURCE_CLIENT_REPOS, libName, item.C_client);
          if (!fs.existsSync(sourcePath)) {
            const fallbackMaster = path.resolve(process.cwd(), '../clonedata/temp/master', libName, item.C_client);
            const fallbackOldAll = path.resolve(process.cwd(), '../clonedata/repos/clientRepos_all', libName, verKey, targetState, item.C_client);
            if (fs.existsSync(fallbackMaster)) sourcePath = fallbackMaster;
            else if (fs.existsSync(fallbackOldAll)) sourcePath = fallbackOldAll;
          }

          const destPath = path.resolve(absCloneDir, item.C_client);

          try {
            if (!fs.existsSync(sourcePath)) continue;
            if (!fs.existsSync(absCloneDir)) OutputJson.createDir(absCloneDir);
            
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.cpSync(sourcePath, destPath, { recursive: true });
            execSync(`git -C "${destPath}" checkout -f ${targetHash}`, { stdio: 'ignore' });
            cloneSuccessCount++;
          } catch (err) {}
        }

        let detectedClientsCount = 0;
        const detectedClients = new Set<string>();

        if (cloneSuccessCount > 0) {
          OutputJson.createDir(absOutDir);
          await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, patternModeFlag);

          const detectJsonPath = path.join(absOutDir, `${phaseName}_detect.json`);
          if (fs.existsSync(detectJsonPath)) {
            try {
              const detectData = JSON.parse(fs.readFileSync(detectJsonPath, 'utf-8')) as ExtendedDetectionOutput;
              if (Array.isArray(detectData.detectedClients)) {
                const rbcSet = new Set(detectData.detectedClients);
                for (const item of targets) {
                  if (rbcSet.has(item.C_client)) {
                    detectedClients.add(item.C_client);
                  }
                }
              }
            } catch (e) {}
          }
          detectedClientsCount = detectedClients.size;
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
          rbcPatternCountAll, rbcPatternCountSuccess, rbcPatternCountFailure,
          targetUpdatedClients: targets.length, activeAnalyzed: activeAnalyzedCount,
          notFixed_PatternDetected: detectedClientsCount,
          fixed_ImplementationChanged: Math.max(0, implementationChangedCount),
          downgraded: downgradeCount, noRelease: noReleaseCount, unknownError: unknownErrorCount
        });

        if (fs.existsSync(absCloneDir)) fs.rmSync(absCloneDir, { recursive: true, force: true });
      };

      await runAnalysis('update', -1);
      for (let i = 0; i < Math.min(3, CONFIG.MAX_RELEASES_TO_TRACK); i++) {
        await runAnalysis(`release_${i + 1}`, i);
      }

      for (const track of clientTracks.values()) allClientTracks.push(track);
      if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
    }
  }

  StatusBar.finish();

  // 抽出した CsvHandler を用いて結果を一括出力
  CsvHandler.writeFullExecutionStats(executionStats, CONFIG.RESULT_BASE_DIR, dateStr);
  CsvHandler.writeClientTracks(allClientTracks, CONFIG.RESULT_BASE_DIR, dateStr);
  CsvHandler.writeExcludedClients(allExcludedClients, CONFIG.RESULT_BASE_DIR, dateStr);
})();