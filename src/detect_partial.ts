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

const CONFIG = {
  TASK_LIST_PATH: '../datasets/mydata/mydata.json',
  HISTORY_BASE_DIR: '../datasets/analysis_target/current/2026-02-24-08-48-48',
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/fulldataSample',
  
  SOURCE_CLIENT_REPOS: '../clonedata/clientRepos',
  UPDATE_CLIENT_BASE: '../clonedata/analysis_temp_repos',
  
  STATE: 'success',
  RESULT_BASE_DIR: '../output/specificData'
};

StatusBar.init();

interface PartialExecutionStat {
  library: string;
  preVersion: string;
  postVersion: string;
  state: string;
  phase: string;
  rbcTotalPatternCount: number;
  targetUpdatedClients: number;
  postUpdateMatchedClients: number;
}

(async () => {
  if (!fs.existsSync(CONFIG.TASK_LIST_PATH)) {
    console.error(`[Error] ${CONFIG.TASK_LIST_PATH} is required for Partial mode.`);
    return;
  }

  const fileContent = fs.readFileSync(CONFIG.TASK_LIST_PATH, 'utf-8');
  const taskList = JSON.parse(fileContent) as { libName: string; preVersion?: string; postVersion: string }[];

  const historyFiles = await GetAllFiles.getRecursively(CONFIG.HISTORY_BASE_DIR);

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

    if (!targetHistoryPath) continue;

    const rbcTargetDir = path.resolve(CONFIG.RBC_DATA_ROOT, `${libName}_${verKey}`);
    if (!fs.existsSync(rbcTargetDir)) continue;

    const localRbcFiles = await GetAllFiles.getRecursively(rbcTargetDir);

    const detectFile = localRbcFiles.find(f => f.endsWith(`${CONFIG.STATE}_detect.json`));
    const detectPatternFile = localRbcFiles.find(f => f.includes('detectpatternlist.json'));
    const fallbackPatternFile = localRbcFiles.find(f => f.includes('patternList.json'));

    const patternFile = detectPatternFile || fallbackPatternFile;

    if (!detectFile || !patternFile) continue;

    let rbcMatchedClients: string[] = [];
    let rbcTotalClientsCount = 0;
    try {
      const data = JSON.parse(fs.readFileSync(detectFile, 'utf-8')) as ExtendedDetectionOutput;
      rbcTotalClientsCount = Number(data.totalClients) || 0;
      if (Array.isArray(data.detectedClients)) {
        rbcMatchedClients = data.detectedClients;
      }
    } catch (e) {}

    if (rbcTotalClientsCount === 0) continue;

    const patternModeFlag = detectPatternFile ? 0 : 1;

    const filteredHistory = GetMatchedClients.filterByMode(targetHistoryPath, rbcMatchedClients);
    const rawTargets = TargetCommits.get(filteredHistory, libName, postVersion);

    const uniqueTargetsMap = new Map<string, any>();
    for (const t of rawTargets) {
      if (!uniqueTargetsMap.has(t.C_client)) {
        uniqueTargetsMap.set(t.C_client, t);
      }
    }
    const targets = Array.from(uniqueTargetsMap.values());

    if (targets.length === 0) continue;

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

      let successCount = 0;
      for (const item of targets) {
        const targetHash = type === 'update' ? item.C_commitID : item.C_tagCommitID;
        if (!targetHash || targetHash === "no-subsequent-release") continue;

        let sourcePath = path.resolve(CONFIG.SOURCE_CLIENT_REPOS, libName, item.C_client);
        if (!fs.existsSync(sourcePath)) {
          const fallbackMaster = path.resolve(process.cwd(), '../clonedata/temp/master', libName, item.C_client);
          if (fs.existsSync(fallbackMaster)) sourcePath = fallbackMaster;
        }

        const destPath = path.resolve(absCloneDir, item.C_client);

        try {
          if (!fs.existsSync(sourcePath)) continue;
          
          if (!fs.existsSync(absCloneDir)) OutputJson.createDir(absCloneDir);
          
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          fs.cpSync(sourcePath, destPath, { recursive: true });
          execSync(`git -C "${destPath}" checkout -f ${targetHash}`, { stdio: 'ignore' });
          successCount++;
        } catch (err) { }
      }

      let detectedCount = 0;
      if (successCount > 0) {
        OutputJson.createDir(absOutDir);
        await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, patternModeFlag);

        // LOOK: リネーム処理を削除し、直接パースする形に修正
        const detectJsonPath = path.join(absOutDir, `${type}_detect.json`);
        if (fs.existsSync(detectJsonPath)) {
          try {
            const detectData = JSON.parse(fs.readFileSync(detectJsonPath, 'utf-8')) as ExtendedDetectionOutput;
            if (Array.isArray(detectData.detectedClients)) {
              const rbcSet = new Set(detectData.detectedClients);
              let localDetectedCount = 0;
              for (const item of targets) {
                if (rbcSet.has(item.C_client)) {
                  localDetectedCount++;
                }
              }
              detectedCount = localDetectedCount;
            }
          } catch (e) {}
        }
      }

      executionStats.push({
        library: libName,
        preVersion: preVersion,
        postVersion: postVersion,
        state: CONFIG.STATE,
        phase: type,
        rbcTotalPatternCount: rbcTotalClientsCount,
        targetUpdatedClients: targets.length,
        postUpdateMatchedClients: detectedCount
      });

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
    const csvHeader = 'Library,PreVersion,PostVersion,State,Phase,RBC_TotalPatternCount,TargetUpdatedClients,PostUpdateMatchedClients\n';

    const writeCsv = (stats: PartialExecutionStat[], type: string) => {
      const validStats = stats.filter(stat => stat.rbcTotalPatternCount > 0);
      if (validStats.length === 0) return;

      const csvPath = path.join(CONFIG.RESULT_BASE_DIR, dateStr, `analysis_summary_${type}_${safeDateStr}.csv`);
      const csvRows = validStats.map(stat =>
        `${stat.library},${stat.preVersion},${stat.postVersion},${stat.state},${stat.phase},${stat.rbcTotalPatternCount},${stat.targetUpdatedClients},${stat.postUpdateMatchedClients}`
      ).join('\n');
      fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf8');
      
      if (type === 'all') {
        console.log(`\n[Done] Summary CSV generated: ${csvPath}`);
      }
    };

    writeCsv(executionStats, 'all');
  }
})();