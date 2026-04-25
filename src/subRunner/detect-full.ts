import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { detectByPattern } from "../../R-BC/src/core/detectByPattern";
import { ExtractFunctionCallsResult } from "../../R-BC/src/types/ExtractFunctionCallsResult";

import StatusBar from "../utils/statusBar";
import TargetCommits from "../utils/targetCommits";
import OutputJson from "../utils/output_json";
import GetAllFiles from "../utils/getAllFiles";
import GetMatchedClients from '../utils/getMatchedClients';

// CSV行データのマッピング用
interface TargetUpdate {
  libName: string;
  preVersion: string;
  postVersion: string;
  SuccessCloned: number;
  FailureCloned: number;
  Status: string;
}

// ==========================================
// INPUT: 実行設定
// ==========================================
const CONFIG = {
  // 抽出処理フェーズで生成されたタスク一覧CSVのパス
  // 対象ライブラリやバージョン、クローン成功数の特定に使用する
  CLONE_SUMMARY_CSV: '../../datasets/analysis_target/verdata/2026-04-02-17-26-21-all/valid_clone_summary.csv',

  // 抽出フェーズで取得した各クライアントのバージョン履歴(JSON)が格納されているディレクトリ
  VERSION_DATA_DIR: '../../datasets/analysis_target/verdata/2026-04-02-17-26-21-all',

  // R-BCによる事前のパターン検出結果(matchResults等)が格納されているルートディレクトリ
  RBC_DATA_ROOT: '../../datasets/analysis_target/rbc_data/2026-04-14-11-23-05-all',

  // 抽出フェーズでクローン済みのクライアントリポジトリ群の格納先
  // 毎回のフルクローンを避けるため、ここからコピーして使用する
  SOURCE_CLIENT_REPOS: '../../clonedata/repos/clientRepos_all',

  // 本解析において、特定コミットへチェックアウトするための作業用一時ディレクトリ
  BASE_CLONE_DIR: '../../clonedata/repos/analysis_temp_repos',

  // 解析結果(JSON)および最終的な集計サマリー(CSV)の出力先ディレクトリ
  RESULT_BASE_DIR: '../../output/specificData_art',

  // 調査対象とするビルド/テストの状態
  STATES: ['success', 'failure'] as const
};
// ==========================================

StatusBar.init();

// 最終集計用のデータ構造
interface ExecutionStat {
  library: string;
  preVersion: string;
  postVersion: string;
  state: string;
  phase: string;
  originalMatchedClients: number;       // 元々のバージョンでパターンが検出された数
  targetUpdatedClients: number;         // 上記のうち、対象バージョンへ更新を行った数
  postUpdateMatchedClients: number;     // 更新後も引き続きパターンが検出された数
  implementationChangedClients: number; // 更新後に実装が変更され、パターンが検出されなくなった数
}

(async () => {
  console.log(`[Init] Checking clone summary CSV: ${CONFIG.CLONE_SUMMARY_CSV}`);

  // 指定パスにCSVが無い場合はディレクトリ内をフォールバック検索
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

  // パーサー依存によるカラム欠落を防ぐため、自前でCSVを分解・構築
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

  // 分析可能なクライアントが存在するタスクのみ抽出
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

    // ディレクトリ検索用に記号を排除したバージョンキーを生成
    const verKey = postVersion.replace(/[^a-zA-Z0-9]/g, '');

    for (const targetState of CONFIG.STATES) {
      currentStep++;
      const progressPercent = ((currentStep / totalSteps) * 100).toFixed(1);

      // 対象ステータスのクライアント数が0ならスキップ
      const clientCountInCsv = targetState === 'success' ? task.SuccessCloned : task.FailureCloned;
      if (clientCountInCsv <= 0) continue;

      StatusBar.update(`⏳ [${currentStep}/${totalSteps} (${progressPercent}%)] Processing: ${libName} (${targetState})`);

      // 履歴JSONの特定
      const stateDataDir = path.join(CONFIG.VERSION_DATA_DIR, targetState, `${libName}-${postVersion}`);
      if (!fs.existsSync(stateDataDir)) continue;

      const historyFiles = fs.readdirSync(stateDataDir);
      const historyFileName = historyFiles.find(f => f.startsWith(`version_history-${targetState}`) && f.endsWith('.json'));
      if (!historyFileName) continue;
      const targetHistoryPath = path.join(stateDataDir, historyFileName);

      // RBCパターンファイルの特定
      const rbcTargetDirBase = rbcFiles.find(f => f.includes(`${libName}_${verKey}`));
      if (!rbcTargetDirBase) continue;
      const rbcTargetDir = rbcTargetDirBase.split(`${libName}_${verKey}`)[0] + `${libName}_${verKey}`;

      const matchFilePath = rbcFiles.find(f => f.startsWith(rbcTargetDir) && f.includes('matchResults.json') && f.includes(targetState));
      const patternFile = rbcFiles.find(f => f.startsWith(rbcTargetDir) && (f.includes('detectpatternlist.json') || f.includes('patternList.json')));

      if (!matchFilePath || !patternFile) continue;

      // 検出パターンファイルの有無で解析モードを判定
      const patternModeFlag = patternFile.includes('detectpatternlist.json') ? 0 : 1;

      // 解析対象となる具体的なコミット群の特定
      const filteredHistory = GetMatchedClients.get(matchFilePath, targetHistoryPath);
      const targets = TargetCommits.get(filteredHistory, libName, postVersion);

      if (targets.length === 0) continue;

      // 後続調査用にターゲット一覧を出力
      const commitLogPath = path.resolve(summaryOutDir, `${libName}-${postVersion}_${targetState}_list.json`);
      const exportTargets = targets.map(t => ({
        client: t.C_client,
        libVersion: t.L_postLibVersion,
        commitID: t.C_commitID,
        tagCommitID: t.C_tagCommitID
      }));
      fs.writeFileSync(commitLogPath, JSON.stringify(exportTargets, null, 2));

      // 検出用パターンの準備
      const patternData = JSON.parse(fs.readFileSync(patternFile, 'utf-8')) as any;
      const rawPatterns: any[] = patternData.patterns ? patternData.patterns.map((p: any) => p.pattern) : patternData;
      const patterns: ExtractFunctionCallsResult[][][] = rawPatterns.map((p: any[]) =>
        p.map((bg: any[]) => bg.flatMap(b => Array.isArray(b) ? b : [b]))
      );

      // 作業用ディレクトリの初期化
      const baseFolderName = `${libName}-${postVersion}_${targetState}`;
      const baseClonePath = path.resolve(CONFIG.BASE_CLONE_DIR, baseFolderName);
      const baseResultPath = path.resolve(CONFIG.RESULT_BASE_DIR, dateStr, 'results', baseFolderName);

      if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
      OutputJson.createDir(baseClonePath);

      // --------------------------------------------------
      // コミット(update時 / release時)ごとの解析処理
      // --------------------------------------------------
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

          // 解析用リポジトリの複製と対象コミットへのチェックアウト
          try {
            if (!fs.existsSync(sourcePath)) continue;
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.cpSync(sourcePath, destPath, { recursive: true });
            execSync(`git -C "${destPath}" checkout -f ${targetHash}`, { stdio: 'ignore' });
            successCount++;
          } catch (err) {
            // チェックアウト失敗等のエラーは握り潰して次へ
          }
        }

        let detectedCount = 0;
        if (successCount > 0) {
          // R-BCを利用したパターンの再検出
          const detectResult = await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, patternModeFlag);
          detectedCount = detectResult.totalClients;

          // 出力結果ファイルの末尾に検出件数を付与してリネーム
          const outputFiles = fs.readdirSync(absOutDir).filter(f => f.endsWith('.json'));
          for (const file of outputFiles) {
            const ext = path.extname(file);
            const base = path.basename(file, ext);
            fs.renameSync(path.join(absOutDir, file), path.join(absOutDir, `${base}_${detectedCount}${ext}`));
          }
        }

        // 統計情報の記録
        const implementationChangedCount = targets.length - detectedCount;
        executionStats.push({
          library: libName,
          preVersion: preVersion,
          postVersion: postVersion,
          state: targetState,
          phase: type,
          originalMatchedClients: filteredHistory.length,
          targetUpdatedClients: targets.length,
          postUpdateMatchedClients: detectedCount,
          implementationChangedClients: implementationChangedCount
        });
      };

      await runAnalysis('update');
      await runAnalysis('release');
    }
  }

  StatusBar.finish();

  // CSVへの結果出力
  if (executionStats.length > 0) {
    const safeDateStr = dateStr.replace(/[: ]/g, '_');
    const csvHeader = 'Library,PreVersion,PostVersion,State,Phase,OriginalMatchedClients,TargetUpdatedClients,PostUpdateMatchedClients,ImplementationChangedClients\n';

    const writeCsv = (stats: ExecutionStat[], type: string) => {
      if (stats.length === 0) return;
      const csvPath = path.join(CONFIG.RESULT_BASE_DIR, dateStr, `analysis_summary_${type}_${safeDateStr}.csv`);
      const csvRows = stats.map(stat =>
        `${stat.library},${stat.preVersion},${stat.postVersion},${stat.state},${stat.phase},${stat.originalMatchedClients},${stat.targetUpdatedClients},${stat.postUpdateMatchedClients},${stat.implementationChangedClients}`
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