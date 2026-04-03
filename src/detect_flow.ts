import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { detectByPattern } from "../R-BC/src/core/detectByPattern";
import { ExtractFunctionCallsResult } from "../R-BC/src/types/ExtractFunctionCallsResult";

// utils はすべてオブジェクトとしてインポート
import OutputJson from "./utils/output_json";
import GetAllFiles from "./utils/getAllFiles";
import GetMatchedClients from './utils/getMatchedClients';
import GetTargetCommits from "./utils/targetCommits";

// ==========================================
// INPUT: 実行設定
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

(async () => {
  const taskList: { libName: string; postVersion: string }[] = JSON.parse(fs.readFileSync(CONFIG.TASK_LIST_PATH, 'utf-8'));

  // GetAllFiles.getRecursively を使用
  const historyFiles = await GetAllFiles.getRecursively(CONFIG.HISTORY_BASE_DIR);
  const rbcFiles = await GetAllFiles.getRecursively(CONFIG.RBC_DATA_ROOT);

  // OutputJson.formatDateTime を使用
  const dateStr = OutputJson.formatDateTime(new Date());

  const summaryOutDir = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'specific-commits');
  OutputJson.createDir(summaryOutDir);

  for (const task of taskList) {
    const { libName, postVersion } = task;
    const verKey = postVersion.replace(/[\.-]/g, '');

    const targetHistoryPath = historyFiles.find(f =>
      f.includes(CONFIG.STATE) && f.includes(`${libName}-${postVersion}`) &&
      path.basename(f).startsWith(`version_history-${CONFIG.STATE}`)
    );

    const rbcTargetDirBase = rbcFiles.find(f => f.includes(`${libName}_${verKey}`));
    const rbcTargetDir = rbcTargetDirBase ? rbcTargetDirBase.split(libName + '_' + verKey)[0] + libName + '_' + verKey : null;

    if (!targetHistoryPath || !rbcTargetDir) continue;
    const matchFilePath = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('matchResults.json') && f.includes(CONFIG.STATE));

    // detectpatternlist.json と patternList.json を個別に探索し、優先度を保証
    const detectPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('detectpatternlist.json'));
    const fallbackPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('patternList.json'));

    const patternFile = detectPatternFile || fallbackPatternFile;

    if (!matchFilePath || !patternFile) continue;

    // detectpatternlist.json が見つかった場合は 0、それ以外（patternList.jsonのみ）の場合は 1 とする
    const patternModeFlag = detectPatternFile ? 0 : 1;

    console.log(`\n--- [Analysis] ${libName}-${postVersion} ---`);

    // GetMatchedClients.get と GetTargetCommits.get を使用
    const filteredHistory = GetMatchedClients.get(matchFilePath, targetHistoryPath);
    const targets = GetTargetCommits.get(filteredHistory, libName, postVersion);

    if (targets.length === 0) continue;

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

    // 階層化したディレクトリ名の定義
    const baseFolderName = `${libName}-${postVersion}_${CONFIG.STATE}`;
    const baseClonePath = path.resolve(process.cwd(), CONFIG.UPDATE_CLIENT_BASE, baseFolderName);
    const baseResultPath = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'results', baseFolderName);

    if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
    OutputJson.createDir(baseClonePath);

    const runAnalysis = async (type: 'update' | 'release') => {
      // 内部階層: base/update または base/release
      const absCloneDir = path.resolve(baseClonePath, type);
      const absOutDir = path.resolve(baseResultPath, type);

      // detectByPattern に渡すための相対パスを計算
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

      if (successCount > 0) {
        console.log(`  [Detect] ${type}地点の解析実行: ${successCount}件 (mode: ${patternModeFlag})`);
        const detectResult = await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, patternModeFlag);

        // 出力された JSON ファイル名の末尾に件数を付与する
        const detectedCount = detectResult.totalClients;
        const outputFiles = fs.readdirSync(absOutDir).filter(f => f.endsWith('.json'));
        for (const file of outputFiles) {
          const oldPath = path.join(absOutDir, file);
          const ext = path.extname(file);
          const base = path.basename(file, ext);
          const newPath = path.join(absOutDir, `${base}_${detectedCount}${ext}`);
          fs.renameSync(oldPath, newPath);
        }
      }
    };

    await runAnalysis('update');
    await runAnalysis('release');
  }
})();