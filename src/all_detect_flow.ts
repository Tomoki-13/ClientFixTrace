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
  CURRENT_BASE_DIR: string; // currentディレクトリのルート（R-BCからの結果を使用）
  RBC_DATA_ROOT: string;
  SOURCE_CLIENT_REPOS: string;
  BASE_CLONE_DIR: string;
  STATES: string[]; // success, failure の両方を処理できるように配列化
  RESULT_BASE_DIR: string;
}

// 実行時の統計情報を保持するための型
interface ExecutionStat {
  sourceDir: string;
  library: string;
  preVersion: string;
  postVersion: string;
  state: string;
  phase: string;
  targetClientsCount: number;
  successfullyClonedCount: number;
  detectedClientsCount: number;
}

const CONFIG: Config = {
  CURRENT_BASE_DIR: '../datasets/analysis_target/current/all-sample', 
  RBC_DATA_ROOT: '../datasets/analysis_target/rbc_data/2026-03-02-15-34-51',
  SOURCE_CLIENT_REPOS: '../clientRepos',
  BASE_CLONE_DIR: '../client_update_alldata', 
  STATES: ['success', 'failure'],
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

// 入力ファイルをパースしてタスクリストを生成する関数
function parseInputData(filePath: string): { libName: string; preVersion: string; postVersion: string }[] {
  const taskList: { libName: string; preVersion: string; postVersion: string }[] = [];
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    const rawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    for (const item of rawData) {
      taskList.push({
        libName: item.libName,
        preVersion: item.preVersion || 'N/A',
        postVersion: item.postVersion || item.newVersion
      });
    }
  } else if (ext === '.csv') {
    const csvContent = fs.readFileSync(filePath, 'utf-8');
    const lines = csvContent.split('\n').filter(l => l.trim().length > 0);
    if (lines.length > 0) {
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const libIdx = headers.indexOf('library');
      const preIdx = headers.indexOf('preversion');
      const postIdx = headers.indexOf('postversion');

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim());
        if (libIdx !== -1 && postIdx !== -1) {
          taskList.push({
            libName: cols[libIdx],
            preVersion: preIdx !== -1 ? cols[preIdx] : 'N/A',
            postVersion: cols[postIdx]
          });
        }
      }
    }
  } else {
    throw new Error(`Unsupported file format: ${ext}`);
  }
  return taskList;
}

(async () => {
  // current以下のディレクトリを一覧取得
  const targetDirs = fs.readdirSync(CONFIG.CURRENT_BASE_DIR)
    .map(name => path.join(CONFIG.CURRENT_BASE_DIR, name))
    .filter(p => fs.statSync(p).isDirectory());

  const rbcFiles = await getAllFilesRecursively(CONFIG.RBC_DATA_ROOT);
  const dateStr = output_json.formatDateTime(new Date());

  const summaryOutDir = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'specific-commits');
  output_json.createOutputDirectory(summaryOutDir);

  const executionStats: ExecutionStat[] = [];

  for (const currentDir of targetDirs) {
    const dirName = path.basename(currentDir);
    console.log(`\n======================================================`);
    console.log(` Processing Directory: ${dirName}`);
    console.log(`======================================================`);

    // ディレクトリ直下の execution_summary_*.csv を自動探索
    const filesInDir = fs.readdirSync(currentDir);
    const csvFileName = filesInDir.find(f => f.startsWith('execution_summary_') && f.endsWith('.csv'));

    if (!csvFileName) {
      console.log(`  [Skip] No 'execution_summary_*.csv' found in ${dirName}.`);
      continue;
    }

    const csvPath = path.join(currentDir, csvFileName);
    console.log(`  Found Target CSV: ${csvFileName}`);
    
    const taskList = parseInputData(csvPath);
    const historyFiles = await getAllFilesRecursively(currentDir); // 探索対象をこのディレクトリ内に限定

    // このディレクトリ用のクローンベースパス（混ざらないように隔離）
    const currentCloneBase = path.resolve(process.cwd(), CONFIG.BASE_CLONE_DIR, dirName);

    for (const task of taskList) {
      const { libName, preVersion, postVersion } = task;
      const verKey = postVersion.replace(/[\.-]/g, '');

      for (const targetState of CONFIG.STATES) {
        // 意図しないCSV等を読み込まないよう .endsWith('.json') で保護
        const targetHistoryPath = historyFiles.find(f =>
          f.includes(targetState) && f.includes(`${libName}-${postVersion}`) &&
          path.basename(f).startsWith(`version_history-${targetState}`) &&
          f.endsWith('.json')
        );

        const rbcTargetDir = rbcFiles.find(f => f.includes(`${libName}_${verKey}`))
          ? rbcFiles.find(f => f.includes(`${libName}_${verKey}`))?.split(libName + '_' + verKey)[0] + libName + '_' + verKey
          : null;

        if (!targetHistoryPath || !rbcTargetDir) continue;
        const matchFilePath = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('matchResults.json') && f.includes(targetState));

        // detectpatternlist.json と patternList.json を個別に探索し、優先度を保証
        const detectPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('detectpatternlist.json') && f.endsWith('.json'));
        const fallbackPatternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('patternList.json') && f.endsWith('.json'));

        const patternFile = detectPatternFile || fallbackPatternFile;

        if (!matchFilePath || !patternFile) continue;
        // detectpatternlist.json が見つかった場合は 0、それ以外（patternList.jsonのみ）の場合は 1 とする
        const patternModeFlag = detectPatternFile ? 0 : 1;

        console.log(`\n--- [Analysis] ${libName}-${postVersion} (${targetState}) ---`);
        const filteredHistory = getMatchedClients.getMatchedClients(matchFilePath, targetHistoryPath);
        const targets = get_target_commits(filteredHistory, libName, postVersion);

        if (targets.length === 0) {
          console.log(`  No target commits found for ${targetState}. Skipping.`);
          continue;
        }

        const commitLogPath = path.resolve(summaryOutDir, `${dirName}_${libName}-${postVersion}_${targetState}_list.json`);
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
        const baseFolderName = `${libName}-${postVersion}_${targetState}`;
        // クローン先のパスを分離
        const baseClonePath = path.resolve(currentCloneBase, baseFolderName);
        const baseResultPath = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, dirName, 'results', baseFolderName);

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

          let detectedCount = 0;
          if (successCount > 0) {
            console.log(`  [Detect] ${type}地点の解析実行: ${successCount}件 (mode: ${patternModeFlag})`);
            const detectResult = await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, patternModeFlag);
            // 先ほどの修正に合わせて scannedDirCount ではなく detectResult.totalClients 等の利用を想定（ここでは元々のロジック通り totalClients を取得）
            detectedCount = detectResult.totalClients;
          }

          // CSV出力用の統計データを保存
          executionStats.push({
            sourceDir: dirName,
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
  }

  // ----------------------------------------
  // CSVファイルの出力処理 (3種類)
  // ----------------------------------------
  if (executionStats.length > 0) {
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    // SourceDir を先頭に追加
    const csvHeader = 'SourceDir,Library,PreVersion,PostVersion,State,Phase,TargetClientsCount,SuccessfullyClonedCount,DetectedClientsCount\n';

    // CSV書き込み用のヘルパー関数
    const writeCsv = (stats: ExecutionStat[], type: string) => {
      if (stats.length === 0) return;
      const csvPath = path.join(CONFIG.RESULT_BASE_DIR, dateStr, `analysis_summary_${type}_${safeDateStr}.csv`);
      const csvRows = stats.map(stat =>
        `${stat.sourceDir},${stat.library},${stat.preVersion},${stat.postVersion},${stat.state},${stat.phase},${stat.targetClientsCount},${stat.successfullyClonedCount},${stat.detectedClientsCount}`
      ).join('\n');
      fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf8');
      console.log(`\nAnalysis Summary CSV Report (${type}) generated at:\n => ${csvPath}`);
    };

    // 全てのデータ
    writeCsv(executionStats, 'all');

    // failureのみ抽出
    const failureStats = executionStats.filter(s => s.state === 'failure');
    writeCsv(failureStats, 'failure');

    // successのみ抽出
    const successStats = executionStats.filter(s => s.state === 'success');
    writeCsv(successStats, 'success');

  } else {
    console.log("\nNo targets were processed.");
  }

})();