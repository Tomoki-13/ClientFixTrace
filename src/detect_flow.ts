import fs from "fs";
import path from "path";
import { Client_Ver, specificCommit, VersionCommits } from "./types/VersionCommits";
import { cloneRepoWithCommit } from "../R-BC/src/utils/cloneRepoWithCommit";
import { detectByPattern } from "../R-BC/src/core/detectByPattern";
import output_json from "./utils/output_json";
import { getAllFilesRecursively } from "./utils/getAllFiles";
import getMatchedClients from './utils/getMatchedClients';

// ==========================================
// 設定
// ==========================================
const CONFIG = {
  TASK_LIST_PATH: '../datasets/mydata/mydata.json',
  HISTORY_BASE_DIR: '../datasets/analysis_target/current/2026-02-24-08-48-48',
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/2026-02-26-11-02-52',
  STATE: 'failure',
  RESULT_BASE_DIR: '../output/specificData'
};

/**
 * ターゲットバージョン以上のエントリを抽出し、新形式に正規化して返す
 */
export function get_target_commits(
  data: Client_Ver[], 
  libName: string, 
  targetVersion: string
): specificCommit[] {
  let result: specificCommit[] = [];
  
  for (const clientData of data) {
    const rawData = clientData as any; // 互換性チェックのため any
    const currentClientName = rawData.C_client || rawData.client;

    // バージョンリストからターゲット以上の最初のインデックスを特定
    const index = rawData.verList.findIndex((v: any) => {
      const vLib = v.L_libVersion || v.libVersion;
      return getMatchedClients.isVersionGreaterOrEqual(vLib, targetVersion);
    });

    if (index !== -1) {
      const postEntry = rawData.verList[index];
      const preEntry = index > 0 ? rawData.verList[index - 1] : null;

      // 新しい型定義 (C_ / L_) に強制的に変換して格納
      result.push({
        C_client: currentClientName,
        L_libName: libName,
        L_targetVersion: targetVersion,
        L_preLibVersion: preEntry ? (preEntry.L_libVersion || preEntry.libVersion) : "unknown/initial",
        L_postLibVersion: postEntry.L_libVersion || postEntry.libVersion,
        C_commitID: postEntry.C_commitID || postEntry.commitID,
        C_tagCommitID: postEntry.C_tagCommitID || postEntry.tagCommitID
      });
    }
  }
  return result;
}

(async () => {
  const taskList = JSON.parse(fs.readFileSync(CONFIG.TASK_LIST_PATH, 'utf-8'));
  const historyFiles = await getAllFilesRecursively(CONFIG.HISTORY_BASE_DIR);
  const rbcFiles = await getAllFilesRecursively(CONFIG.RBC_DATA_ROOT);
  const dateStr = output_json.formatDateTime(new Date());

  const stateLabel = CONFIG.STATE.charAt(0).toUpperCase() + CONFIG.STATE.slice(1);
  const cloneBaseDir = `../../allupdate${stateLabel}Client`;

  for (const task of taskList) {
    const { libName, postVersion } = task;
    const verKey = postVersion.replace(/[\.-]/g, '');

    const targetHistoryPath = historyFiles.find(f => {
      const parts = f.split(path.sep);
      return parts.includes(CONFIG.STATE) && parts.includes(`${libName}-${postVersion}`) &&
        path.basename(f).startsWith(`version_history-${CONFIG.STATE}`);
    });

    const rbcTargetDir = rbcFiles.find(f => f.includes(`${libName}_${verKey}`))
      ? rbcFiles.find(f => f.includes(`${libName}_${verKey}`))?.split(libName + '_' + verKey)[0] + libName + '_' + verKey
      : null;

    if (!targetHistoryPath || !rbcTargetDir) {
      console.warn(`\n[Skip] データ不足: ${libName}-${postVersion}`);
      continue;
    }

    const matchFilePath = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('matchResults.json') && f.includes(CONFIG.STATE));
    const patternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && (f.includes('detectpatternlist.json') || f.includes('patternList.json')));

    if (!matchFilePath || !patternFile) {
      console.warn(`[Skip] JSON未検出: ${rbcTargetDir}`);
      continue;
    }

    console.log(`\n--- [Process] ${libName}-${postVersion} ---`);

    // 2. フィルタリングと正規化抽出
    const filteredHistory = getMatchedClients.getMatchedClients(matchFilePath, targetHistoryPath);
    const targets = get_target_commits(filteredHistory, libName, postVersion);

    console.log(`  [Stats] 履歴一致: ${filteredHistory.length}, 解析対象候補: ${targets.length}`);

    if (targets.length === 0) continue;

    // 候補リストをJSON出力（常に新形式で保存される）
    const commitOutDir = path.resolve(process.cwd(), `${CONFIG.RESULT_BASE_DIR}/${dateStr}/${libName}/specific-commits`);
    output_json.createOutputDirectory(commitOutDir);
    const commitLogPath = output_json.getUniqueOutputPath(commitOutDir, `${libName}-${postVersion}-${CONFIG.STATE}`, 'list');
    fs.writeFileSync(commitLogPath, JSON.stringify(targets, null, 2));

    const patternData = JSON.parse(fs.readFileSync(patternFile, 'utf-8'));
    const patterns = patternData.patterns ? patternData.patterns.map((p: any) => p.pattern) : patternData;

    /*
    const runAnalysis = async (type: 'commitID' | 'tagCommitID') => {
      const currentCloneDir = path.resolve(process.cwd(), `${cloneBaseDir}/${libName}-${postVersion}-${CONFIG.STATE}_${type}`);
      const outDir = path.resolve(process.cwd(), `${CONFIG.RESULT_BASE_DIR}/${dateStr}/${libName}/detectByPattern/${type}`);
      
      output_json.createOutputDirectory(currentCloneDir);
      output_json.createOutputDirectory(outDir);

      let successCount = 0;
      for (const item of targets) {
        // 新形式のキー（C_）を参照
        const targetHash = type === 'commitID' ? item.C_commitID : item.C_tagCommitID;
        
        if (!targetHash || targetHash === "no-subsequent-release") continue;

        if (await cloneRepoWithCommit(item.C_client, currentCloneDir, targetHash)) {
          successCount++;
        }
      }

      if (successCount > 0) {
        console.log(`  [Detect] ${type}地点の解析実行中... (${successCount}件)`);
        await detectByPattern(currentCloneDir, libName, patterns, outDir, true, 0);
      }
    };

    await runAnalysis('commitID');
    await runAnalysis('tagCommitID');
    */
  }
})();