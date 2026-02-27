import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { Client_Ver, specificCommit } from "./types/VersionCommits";
import { detectByPattern } from "../R-BC/src/core/detectByPattern";
import output_json from "./utils/output_json";
import { getAllFilesRecursively } from "./utils/getAllFiles";
import { ExtractFunctionCallsResult } from "../R-BC/src/types/ExtractFunctionCallsResult";
import getMatchedClients from './utils/getMatchedClients';

interface Config {
  TASK_LIST_PATH: string;
  HISTORY_BASE_DIR: string;
  RBC_DATA_ROOT: string;
  SOURCE_CLIENT_REPOS: string;
  UPDATE_CLIENT_BASE: string;
  STATE: string;
  RESULT_BASE_DIR: string;
}

const CONFIG: Config = {
  TASK_LIST_PATH: '../datasets/mydata/mydata.json',
  HISTORY_BASE_DIR: '../datasets/analysis_target/current/2026-02-24-08-48-48',
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/2026-02-26-15-31-06',
  SOURCE_CLIENT_REPOS: '../clientRepos',
  UPDATE_CLIENT_BASE: '../client_update',
  STATE: 'failure',
  RESULT_BASE_DIR: '../output/specificData'
};

export function get_target_commits(data: Client_Ver[], libName: string, targetVersion: string): specificCommit[] {
  let result: specificCommit[] = [];
  for (const clientData of data) {
    const raw = clientData as any;
    const index = raw.verList.findIndex((v: any) =>
      getMatchedClients.isVersionGreaterOrEqual(v.L_libVersion || v.libVersion, targetVersion)
    );
    if (index !== -1) {
      const post = raw.verList[index];
      const pre = index > 0 ? raw.verList[index - 1] : null;
      result.push({
        C_client: raw.C_client || raw.client,
        L_libName: libName,
        L_targetVersion: targetVersion,
        L_preLibVersion: pre ? (pre.L_libVersion || pre.libVersion) : "unknown/initial",
        L_postLibVersion: post.L_libVersion || post.libVersion,
        C_commitID: post.C_commitID || post.commitID,
        C_tagCommitID: post.C_tagCommitID || post.tagCommitID
      });
    }
  }
  return result;
}

(async () => {
  const taskList: { libName: string; postVersion: string }[] = JSON.parse(fs.readFileSync(CONFIG.TASK_LIST_PATH, 'utf-8'));
  const historyFiles = await getAllFilesRecursively(CONFIG.HISTORY_BASE_DIR);
  const rbcFiles = await getAllFilesRecursively(CONFIG.RBC_DATA_ROOT);
  const dateStr = output_json.formatDateTime(new Date());

  const summaryOutDir = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'specific-commits');
  output_json.createOutputDirectory(summaryOutDir);

  for (const task of taskList) {
    const { libName, postVersion } = task;
    const verKey = postVersion.replace(/[\.-]/g, '');

    const targetHistoryPath = historyFiles.find(f =>
      f.includes(CONFIG.STATE) && f.includes(`${libName}-${postVersion}`) &&
      path.basename(f).startsWith(`version_history-${CONFIG.STATE}`)
    );

    const rbcTargetDir = rbcFiles.find(f => f.includes(`${libName}_${verKey}`))
      ? rbcFiles.find(f => f.includes(`${libName}_${verKey}`))?.split(libName + '_' + verKey)[0] + libName + '_' + verKey
      : null;

    if (!targetHistoryPath || !rbcTargetDir) continue;

    const matchFilePath = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('matchResults.json') && f.includes(CONFIG.STATE));
    const patternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && (f.includes('detectpatternlist.json') || f.includes('patternList.json')));

    if (!matchFilePath || !patternFile) continue;

    console.log(`\n--- [Analysis] ${libName}-${postVersion} ---`);
    const filteredHistory = getMatchedClients.getMatchedClients(matchFilePath, targetHistoryPath);
    const targets = get_target_commits(filteredHistory, libName, postVersion);

    if (targets.length === 0) continue;

    // 母数リストの保存
    const commitLogPath = path.resolve(summaryOutDir, `${libName}-${postVersion}_${CONFIG.STATE}_list.json`);
    const exportTargets = targets.map(t => ({
      client: t.C_client,
      libVersion: t.L_postLibVersion,
      commitID: t.C_commitID,
      tagCommitID: t.C_tagCommitID
    }));
    fs.writeFileSync(commitLogPath, JSON.stringify(exportTargets, null, 2));

    // パターン正規化
    const patternData = JSON.parse(fs.readFileSync(patternFile, 'utf-8'));
    const rawPatterns: any[] = patternData.patterns ? patternData.patterns.map((p: any) => p.pattern) : patternData;
    const patterns: ExtractFunctionCallsResult[][][] = rawPatterns.map((p: any[]) => 
      p.map((bg: any[]) => bg.flatMap(b => Array.isArray(b) ? b : [b]))
    );

    // 階層化したディレクトリ名の定義
    const baseFolderName = `${libName}-${postVersion}_${CONFIG.STATE}`;
    const baseClonePath = path.resolve(process.cwd(), CONFIG.UPDATE_CLIENT_BASE, baseFolderName);
    const baseResultPath = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'results', baseFolderName);

    // タスク開始時に一度だけ親ディレクトリを初期化
    if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
    output_json.createOutputDirectory(baseClonePath);

    const runAnalysis = async (type: 'update' | 'release') => {
      // 内部階層: base/update または base/release
      const absCloneDir = path.resolve(baseClonePath, type);
      const absOutDir = path.resolve(baseResultPath, type);

      // detectByPattern に渡すための相対パスを計算
      const relativeCloneDir = path.relative(process.cwd(), absCloneDir);

      output_json.createOutputDirectory(absCloneDir);
      output_json.createOutputDirectory(absOutDir);

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
        console.log(`  [Detect] ${type}地点の解析実行: ${successCount}件`);
        // 相対パスを渡すことで、結果ファイル内の記述を簡略化
        await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, 0);
      }
    };

    await runAnalysis('update');
    await runAnalysis('release');
  }
})();