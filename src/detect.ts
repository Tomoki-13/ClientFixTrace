// src/detect.ts
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { detectByPattern } from "../../R-BC/src/core/detectByPattern";

import StatusBar from "./utils/StatusBar";
import TargetCommits from "./analysis/targetCommits";
import OutputJson from "./utils/output_json";
import GetAllFiles from "./utils/getAllFiles";
import GetMatchedClients from './utils/getMatchedClients';
import VersionUtil from "./analysis/versionUtil";
import CsvHandler from "./utils/csvHandler";

import { ExtractFunctionCallsResult, ExtendedDetectionOutput } from "./types/RbcTypes";
import { ExecutionStat, ClientTrack, ExcludedClient } from "./types/AnalysisTypes";

// ==========================================
// 実行 ID: Meta Makefile からの BCPG_RUN_ID があればそれを使用、なければ実行時に生成
// 出力は outputs/history/ClientFixTrace/detect/<RUN_ID>/ に書き、Meta Makefile が outputs/latest/ClientFixTrace/ にコピーする
// ==========================================
const RUN_ID: string = process.env.BCPG_RUN_ID ?? OutputJson.formatDateTime(new Date());

// ==========================================
// INPUT: 実行設定
// ==========================================
const CONFIG = {
  /**
   * ソースを直接変更してモード固定する場合はここを書き換え
   * CLI引数があればそちらを優先
   */
  DEFAULT_MODE: 'full' as 'full' | 'partial',

  /**
   * パターン検出モード (CLI第2引数 or ここを書き換えて固定)
   *   0  : コードのみ (detectpatternlist.json / 型情報なし・広域マッチ)
   *   1  : コード + 型完全一致 (type-method)
   *   1.5: 1 と同じマッチングだが unknown 型のみの呼び出しを除いた厳格版 (type-method の *_no_unknown)
   *   2  : コード + 型一致 + object キー部分一致 (type-method-object)
   *   2.5: 2 と同じマッチングだが unknown 型のみの呼び出しを除いた厳格版 (type-method-object の *_no_unknown)
   *   ※ .5 は「整数モードの no_unknown バリアント」を表す（R-BC が typed モード実行時に併せて出力）
   */
  DEFAULT_DETECT_MODE: 0 as 0 | 1 | 1.5 | 2 | 2.5,

  // 入出力パスは親ディレクトリ（BCPatternGen メタリポ）配下を参照する
  // 単体実行は現在サポートされない（README 参照）

  // ===== Full モード設定 =====
  FULL: {
    // 抽出フェーズで出力された valid_clone_summary.csv のパス（新レイアウト: <mode>/_summary/）
    CLONE_SUMMARY_CSV: '../../outputs/latest/ClientFixTrace/verHist/full/_summary/valid_clone_summary.csv',
    // verHist 出力のモードルート（<mode> 直下に <lib>@<post>/<state>/ と _summary/ がある）
    //   mode = full / partial / rbc-method / rbc-type-method / rbc-type-method-object
    VERSION_DATA_DIR: '../../outputs/latest/ClientFixTrace/verHist/full',
    // R-BC 解析結果ルート (latest を参照 / 過去履歴は outputs/history/R-BC/<mode>/<run_id> を指定)
    RBC_M0: '../../outputs/latest/R-BC/method',
    RBC_M1: '../../outputs/latest/R-BC/type-method',
    RBC_M2: '../../outputs/latest/R-BC/type-method-object',
    // 使用する RBC パターンの種別
    //   standard   : createPattern / detectByPattern (通常)
    //   no_unknown : createPattern_no_unknown / detectByPattern_no_unknown (unknown型除外・条件厳格)
    VARIANT: 'standard' as 'standard' | 'no_unknown',
    // クライアントリポジトリの永続キャッシュ
    SOURCE_CLIENT_REPOS: '../../clonedata/clientRepos',
    // 一時作業ディレクトリ (解析後に削除される)
    BASE_CLONE_DIR: '../../clonedata/analysis_temp_repos',
    // 最終サマリーCSV・詳細JSONの出力先（runMode を分けて latest 上書き衝突を防ぐ）
    RESULT_BASE_DIR: `../../outputs/history/ClientFixTrace/detect/full/${RUN_ID}`,
    // 対象ステート (success / failure の両方を処理)
    STATES: ['success', 'failure'] as const,
    // update の後に追跡する後続リリース数 (0〜3)
    MAX_RELEASES_TO_TRACK: 3,
  },

  // ===== Partial モード設定 =====
  PARTIAL: {
    // 処理対象タスク一覧 (必須)
    TASK_LIST_PATH: '../../datasets/targets.json',
    // verHist の出力モードルート (full / partial / rbc-* のいずれでも可)
    VERSION_DATA_DIR: '../../outputs/latest/ClientFixTrace/verHist/partial',
    // partial の履歴が無いとき参照するフォールバック（full は partial を包含＝流用可） / 空文字で無効
    VERSION_DATA_DIR_FALLBACK: '../../outputs/latest/ClientFixTrace/verHist/full',
    // R-BC 解析結果ルート (latest を参照 / 過去履歴は outputs/history/R-BC/<mode>/<run_id> を指定)
    RBC_M0: '../../outputs/latest/R-BC/method',
    RBC_M1: '../../outputs/latest/R-BC/type-method',
    RBC_M2: '../../outputs/latest/R-BC/type-method-object',
    // 使用する RBC パターンの種別
    //   standard   : createPattern / detectByPattern (通常)
    //   no_unknown : createPattern_no_unknown / detectByPattern_no_unknown (unknown型除外・条件厳格)
    VARIANT: 'standard' as 'standard' | 'no_unknown',
    // クライアントリポジトリの永続キャッシュ
    SOURCE_CLIENT_REPOS: '../../clonedata/clientRepos',
    // 一時作業ディレクトリ (解析後に削除される)
    BASE_CLONE_DIR: '../../clonedata/analysis_temp_repos',
    // 最終サマリーCSV・詳細JSONの出力先（runMode を分けて latest 上書き衝突を防ぐ）
    RESULT_BASE_DIR: `../../outputs/history/ClientFixTrace/detect/partial/${RUN_ID}`,
    // 対象ステート (success / failure 両方を処理 / 無ければスキップ)
    STATES: ['success', 'failure'] as const,
    // update の後に追跡する後続リリース数 (0〜3)
    MAX_RELEASES_TO_TRACK: 3,
  },
};

// CLI引数 or CONFIG.DEFAULT_MODE でモードを決定
const MODE = (['full', 'partial'].includes(process.argv[2])
  ? process.argv[2]
  : CONFIG.DEFAULT_MODE) as 'full' | 'partial';

// CLI第2引数 (0/1/1.5/2/2.5) or CONFIG.DEFAULT_DETECT_MODE で検出モードを決定
const VALID_DETECT_MODES = [0, 1, 1.5, 2, 2.5];
const _rawDetectMode = process.argv[3];
if (_rawDetectMode !== undefined && !VALID_DETECT_MODES.includes(Number(_rawDetectMode))) {
  console.warn(`[Warn] DETECT_MODE="${_rawDetectMode}" は無効です (有効値: 0/1/1.5/2/2.5)。DEFAULT_DETECT_MODE=${CONFIG.DEFAULT_DETECT_MODE} を使用します。`);
}
const DETECT_MODE = (VALID_DETECT_MODES.includes(Number(_rawDetectMode))
  ? Number(_rawDetectMode)
  : CONFIG.DEFAULT_DETECT_MODE) as 0 | 1 | 1.5 | 2 | 2.5;

// .5 モード（1.5 / 2.5）= 整数モードと同じマッチングで no_unknown バリアントを参照
//   実効モード = 整数部（マッチング/パターン選択/RBC ルートに使用） / .5 は _no_unknown 参照フラグ
const EFFECTIVE_DETECT_MODE = Math.floor(DETECT_MODE) as 0 | 1 | 2;
const FORCE_NO_UNKNOWN = !Number.isInteger(DETECT_MODE);
// 出力ディレクトリ名（no_unknown は専用フォルダに分離）
const DETECT_MODE_DIR = ({
  0: 'method',
  1: 'type-method',
  1.5: 'type-method-no-unknown',
  2: 'type-method-object',
  2.5: 'type-method-object-no-unknown',
} as Record<number, string>)[DETECT_MODE];

StatusBar.init();

// ==========================================
// 共通ユーティリティ
// ==========================================

/**
 * ソースリポジトリのパスを解決
 * sourceReposRoot/{libName}/{clientName} を優先、なければ
 * clonedata/temp/master/{libName}/{clientName} にフォールバック
 */
function resolveSourcePath(sourceReposRoot: string, libName: string, clientName: string): string {
  const primary = path.resolve(sourceReposRoot, libName, clientName);
  if (fs.existsSync(primary)) return primary;
  const fallback = path.resolve(process.cwd(), '../clonedata/temp/master', libName, clientName);
  return fs.existsSync(fallback) ? fallback : primary;
}

/**
 * リポジトリを一時ディレクトリへコピーし指定ハッシュへチェックアウト
 * 成功=true / 失敗=false
 */
function checkoutToDir(sourcePath: string, destPath: string, commitHash: string): boolean {
  try {
    if (!fs.existsSync(sourcePath)) return false;
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.cpSync(sourcePath, destPath, { recursive: true });
    execSync(`git -C "${destPath}" checkout -f ${commitHash}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 検出モードに応じたパターンファイルを選択し 3階層構造に変換
 *   mode 0 → detectpatternlist.json (型なし広域マッチ)
 *   mode 1/2(/.5) → patternList[_no_unknown].json (型情報あり)
 * 見つからない場合は null
 */
function loadPatterns(
  rbcFiles: string[],
  detectMode: 0 | 1 | 2
): { patterns: ExtractFunctionCallsResult[][][] } | null {
  let patternFile: string | undefined;
  if (detectMode === 0) {
    // mode 0: 型なしファイル優先、なければ型ありにフォールバック
    patternFile =
      rbcFiles.find(f => f.includes('detectpatternlist.json')) ??
      rbcFiles.find(f => f.includes('patternList.json'));
  } else {
    // mode 1/2: 型情報必須　patternList.json と patternList_no_unknown.json の双方に対応
    // （rbcFiles は呼び出し側で createPattern[_no_unknown] ディレクトリに絞り込み済み）
    patternFile = rbcFiles.find(f =>
      f.includes('patternList') && !f.includes('detectpatternlist')
    );
  }
  if (!patternFile) return null;

  const raw = JSON.parse(fs.readFileSync(patternFile, 'utf-8')) as any;
  const rawPatterns: any[] = raw?.patterns
    ? raw.patterns.map((p: any) => p.pattern)
    : (raw || []);
  const patterns: ExtractFunctionCallsResult[][][] = rawPatterns.map((p: any[]) =>
    p.map((bg: any[]) => bg.flatMap(b => Array.isArray(b) ? b : [b]))
  );
  return { patterns };
}

// ==========================================
// Full モード
// ==========================================

interface ExtendedExecutionStat extends ExecutionStat {
  rbcPatternCountAll: number;
  rbcPatternCountSuccess: number;
  rbcPatternCountFailure: number;
}

async function runFullMode(): Promise<void> {
  const C = CONFIG.FULL;

  // DETECT_MODE に対応する RBC ルートを解決（.5 モードは整数部のルートを流用）
  const rbcRoot = [C.RBC_M0, C.RBC_M1, C.RBC_M2][EFFECTIVE_DETECT_MODE];
  if (!rbcRoot) {
    console.error(`[Error] CONFIG.FULL.RBC_M${EFFECTIVE_DETECT_MODE} が未設定です。detect.ts の CONFIG を確認してください。`);
    StatusBar.finish();
    return;
  }
  // .5 モード もしくは VARIANT=no_unknown のとき _no_unknown サブディレクトリを参照
  const suffix = (C.VARIANT === 'no_unknown' || FORCE_NO_UNKNOWN) ? '_no_unknown' : '';
  const cpDir = `createPattern${suffix}`;
  const dpDir = `detectByPattern${suffix}`;
  const resultDir = path.resolve(C.RESULT_BASE_DIR, DETECT_MODE_DIR);

  // CSV ファイルのパス解決
  let cloneSummaryPath = C.CLONE_SUMMARY_CSV;
  if (!fs.existsSync(cloneSummaryPath)) {
    cloneSummaryPath = path.join(C.VERSION_DATA_DIR, '_summary', 'valid_clone_summary.csv');
    if (!fs.existsSync(cloneSummaryPath)) {
      console.error(`[Error] CSV file not found!`);
      StatusBar.finish();
      return;
    }
  }

  const taskList = CsvHandler.loadCloneSummary(cloneSummaryPath)
    .filter(t => t.SuccessCloned > 0 || t.FailureCloned > 0);
  if (taskList.length === 0) { StatusBar.finish(); return; }

  const dateStr = RUN_ID + '-all';
  const summaryOutDir = path.resolve(resultDir, dateStr, 'specific-commits');
  OutputJson.createDir(summaryOutDir);

  const executionStats: ExtendedExecutionStat[] = [];
  const finalStats: any[] = []; // クライアント最終状態からのクリーン集計 (condensed 用)
  const allClientTracks: ClientTrack[] = [];
  const allExcludedClients: ExcludedClient[] = [];
  const totalSteps = taskList.length * C.STATES.length;
  let currentStep = 0;

  for (const task of taskList) {
    const { libName, preVersion, postVersion } = task;
    if (!libName || !postVersion) continue;

    const verKey = postVersion.replace(/[^a-zA-Z0-9]/g, '');

    for (const targetState of C.STATES) {
      currentStep++;
      const pct = ((currentStep / totalSteps) * 100).toFixed(1);
      StatusBar.update(`⏳ [${currentStep}/${totalSteps} (${pct}%)] Processing: ${libName} (${targetState})`);

      // スキップ時も空レコードを記録する補助関数
      const recordEmptyStats = (rAll = 0, rSuc = 0, rFail = 0) => {
        const phases = [
          'update',
          ...Array.from({ length: Math.min(3, C.MAX_RELEASES_TO_TRACK) }, (_, i) => `release_${i + 1}`)
        ];
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

      // 履歴 JSON の特定
      const stateDataDir = path.join(C.VERSION_DATA_DIR, `${libName}@${postVersion}`, targetState);
      if (!fs.existsSync(stateDataDir)) continue;

      const dirFiles = fs.readdirSync(stateDataDir);
      const historyFileName = dirFiles.find(f =>
        f.startsWith(`version_history-${targetState}`) && f.endsWith('.json')
      );
      if (!historyFileName) continue;
      const targetHistoryPath = path.join(stateDataDir, historyFileName);

      // RBC ファイルの特定
      const rbcTargetDir = path.resolve(rbcRoot, `${libName}_${verKey}`);
      if (!fs.existsSync(rbcTargetDir)) continue;

      const localRbcFiles = (await GetAllFiles.getRecursively(rbcTargetDir))
        .filter(f => f.includes(`/${cpDir}/`) || f.includes(`/${dpDir}/`));
      const successDetectFile = localRbcFiles.find(f => f.endsWith('success_detect.json'));
      const failureDetectFile = localRbcFiles.find(f => f.endsWith('failure_detect.json'));
      const loadedPatterns = loadPatterns(localRbcFiles, EFFECTIVE_DETECT_MODE);
      if (!loadedPatterns) continue;

      const currentDetectFile = targetState === 'success' ? successDetectFile : failureDetectFile;
      if (!currentDetectFile) continue;

      // RBC クライアント数の集計
      let rbcPatternCountSuccess = 0, rbcPatternCountFailure = 0;
      if (successDetectFile) {
        try {
          rbcPatternCountSuccess =
            Number((JSON.parse(fs.readFileSync(successDetectFile, 'utf-8')) as ExtendedDetectionOutput).totalClients) || 0;
        } catch { /* ignore */ }
      }
      if (failureDetectFile) {
        try {
          rbcPatternCountFailure =
            Number((JSON.parse(fs.readFileSync(failureDetectFile, 'utf-8')) as ExtendedDetectionOutput).totalClients) || 0;
        } catch { /* ignore */ }
      }
      const rbcPatternCountAll = rbcPatternCountSuccess + rbcPatternCountFailure;
      if (rbcPatternCountAll === 0) continue;

      let rbcMatchedClients: string[] = [];
      try {
        const d = JSON.parse(fs.readFileSync(currentDetectFile, 'utf-8')) as ExtendedDetectionOutput;
        if (Array.isArray(d.detectedClients)) rbcMatchedClients = d.detectedClients;
      } catch { /* ignore */ }

      const filteredHistory = GetMatchedClients.filterByMode(targetHistoryPath, rbcMatchedClients);
      const rawTargets = TargetCommits.get(filteredHistory, libName, postVersion);

      // 同一クライアントの重複を排除
      const uniqueTargetsMap = new Map<string, any>();
      for (const t of rawTargets) {
        if (!uniqueTargetsMap.has(t.C_client)) uniqueTargetsMap.set(t.C_client, t);
      }
      const targets = Array.from(uniqueTargetsMap.values());

      // 履歴には存在するが targets に含まれないクライアントを除外リストへ
      const targetedSet = new Set(targets.map((t: any) => t.C_client));
      for (const c of rbcMatchedClients) {
        if (!targetedSet.has(c)) {
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

      // ターゲット一覧の出力
      const commitLogPath = path.resolve(summaryOutDir, `${libName}-${postVersion}_${targetState}_list.json`);
      fs.writeFileSync(commitLogPath, JSON.stringify(
        targets.map((t: any) => ({
          client: t.C_client, libVersion: t.L_postLibVersion,
          commitID: t.C_commitID, tagCommitID: t.C_tagCommitID
        })), null, 2
      ));

      const { patterns } = loadedPatterns;
      const baseFolderName = `${libName}-${postVersion}_${targetState}`;
      const baseClonePath = path.resolve(C.BASE_CLONE_DIR, baseFolderName);
      const baseResultPath = path.resolve(resultDir, dateStr, 'results', baseFolderName);

      if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
      OutputJson.createDir(baseClonePath);

      // クライアントごとの状態管理マップ
      const clientStatus = new Map<string, 'active' | 'fixed' | 'downgraded' | 'no_release' | 'unknown_error'>();
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

      /**
       * 1フェーズ分の解析を実行
       * phaseIndex === -1 → update フェーズ
       * phaseIndex >= 0  → release_{phaseIndex+1} フェーズ
       */
      const runAnalysis = async (phaseName: string, phaseIndex: number) => {
        const absCloneDir = path.resolve(baseClonePath, phaseName);
        const absOutDir = path.resolve(baseResultPath, phaseName);
        const relativeCloneDir = path.relative(process.cwd(), absCloneDir);

        let activeAnalyzedCount = 0, cloneSuccessCount = 0;
        let downgradeCount = 0, noReleaseCount = 0, unknownErrorCount = 0;

        for (const item of targets) {
          const track = clientTracks.get(item.C_client)!;
          let currentStatus = clientStatus.get(item.C_client);
          let targetHash = '';
          let currentLibVer = postVersion;

          if (phaseIndex === -1) {
            // update フェーズ: バージョン更新直後のコミット
            targetHash = item.C_commitID;
            currentLibVer = item.L_postLibVersion || postVersion;
          } else {
            // release フェーズ: 後続リリースタグを追跡
            const clientData = filteredHistory.find((c: any) => c.C_client === item.C_client);
            const ver = clientData?.verList?.find((v: any) => v.C_commitID === item.C_commitID);

            let releases: any[] = [];
            if (ver && Array.isArray(ver.C_releases) && ver.C_releases.length > 0) {
              releases = ver.C_releases as any[];
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

          // active 状態の追加検証
          if (currentStatus === 'active') {
            if (!currentLibVer || currentLibVer === 'unknown' || currentLibVer === 'not_found') {
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

          // ClientTrack へバージョン記録
          if (phaseName === 'update')   track.Update_LibVer = currentLibVer || '-';
          if (phaseName === 'release_1') track.R1_LibVer     = currentLibVer || '-';
          if (phaseName === 'release_2') track.R2_LibVer     = currentLibVer || '-';
          if (phaseName === 'release_3') track.R3_LibVer     = currentLibVer || '-';

          if (currentStatus !== 'active') {
            // 'fixed' は前フェーズで修正済み → カウントせずスキップ
            if (currentStatus === 'downgraded')    downgradeCount++;
            if (currentStatus === 'no_release')    noReleaseCount++;
            if (currentStatus === 'unknown_error') unknownErrorCount++;
            continue;
          }

          // 一時ディレクトリへコピー & チェックアウト
          activeAnalyzedCount++;
          const sourcePath = resolveSourcePath(C.SOURCE_CLIENT_REPOS, libName, item.C_client);
          const destPath = path.resolve(absCloneDir, item.C_client);
          if (!fs.existsSync(absCloneDir)) OutputJson.createDir(absCloneDir);
          if (checkoutToDir(sourcePath, destPath, targetHash)) cloneSuccessCount++;
        }

        // AST パターン検出
        let detectedClientsCount = 0;
        const detectedClients = new Set<string>();
        if (cloneSuccessCount > 0) {
          OutputJson.createDir(absOutDir);
          await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, EFFECTIVE_DETECT_MODE);

          const detectJsonPath = path.join(absOutDir, `${phaseName}_detect.json`);
          if (fs.existsSync(detectJsonPath)) {
            try {
              const dd = JSON.parse(fs.readFileSync(detectJsonPath, 'utf-8')) as ExtendedDetectionOutput;
              if (Array.isArray(dd.detectedClients)) {
                const rbcSet = new Set(dd.detectedClients);
                for (const item of targets) {
                  if (rbcSet.has(item.C_client)) detectedClients.add(item.C_client);
                }
              }
            } catch { /* ignore */ }
          }
          detectedClientsCount = detectedClients.size;
        }

        // ClientTrack へステータス記録
        for (const item of targets) {
          const track = clientTracks.get(item.C_client)!;
          const st = clientStatus.get(item.C_client);
          let statusStr = '-';
          if      (st === 'downgraded')    statusStr = 'Downgraded (Rolled Back)';
          else if (st === 'no_release')    statusStr = 'No Release';
          else if (st === 'unknown_error') statusStr = 'Unknown Error';
          else if (st === 'fixed')         statusStr = 'Fixed (Impl Changed)';
          else if (st === 'active') {
            const destPath = path.resolve(absCloneDir, item.C_client);
            if (!fs.existsSync(destPath)) {
              statusStr = 'Clone Failed';
            } else if (detectedClients.has(item.C_client)) {
              statusStr = 'Not Fixed (Pattern Detected)';
            } else {
              statusStr = 'Fixed (Impl Changed)';
              clientStatus.set(item.C_client, 'fixed'); // 後続フェーズで再カウントしない
            }
          }
          if (phaseName === 'update')   track.Update_Status = statusStr;
          if (phaseName === 'release_1') track.R1_Status     = statusStr;
          if (phaseName === 'release_2') track.R2_Status     = statusStr;
          if (phaseName === 'release_3') track.R3_Status     = statusStr;
        }

        executionStats.push({
          library: libName, preVersion, postVersion, state: targetState, phase: phaseName,
          rbcTotalPatternCount: 0,
          rbcPatternCountAll, rbcPatternCountSuccess, rbcPatternCountFailure,
          targetUpdatedClients: targets.length, activeAnalyzed: activeAnalyzedCount,
          notFixed_PatternDetected: detectedClientsCount,
          fixed_ImplementationChanged: Math.max(0, activeAnalyzedCount - detectedClientsCount),
          downgraded: downgradeCount, noRelease: noReleaseCount, unknownError: unknownErrorCount
        });

        // 一時ディレクトリを即削除
        if (fs.existsSync(absCloneDir)) fs.rmSync(absCloneDir, { recursive: true, force: true });
      };

      await runAnalysis('update', -1);
      for (let i = 0; i < Math.min(3, C.MAX_RELEASES_TO_TRACK); i++) {
        await runAnalysis(`release_${i + 1}`, i);
      }

      // クライアント最終状態(排他)からクリーンに集計: Updated = Fixed + Downgraded + NotFixed
      const tally: Record<string, number> = { fixed: 0, downgraded: 0, no_release: 0, unknown_error: 0, active: 0 };
      for (const st of clientStatus.values()) tally[st] = (tally[st] ?? 0) + 1;
      finalStats.push({
        library: libName, preVersion, postVersion, state: targetState,
        rbcDetected: targetState === 'success' ? rbcPatternCountSuccess : rbcPatternCountFailure,
        updated: targets.length,
        fixed: tally.fixed,
        downgraded: tally.downgraded,
        notFixed: tally.active + tally.no_release + tally.unknown_error,
        notFixedStillDetected: tally.active,
        notFixedNoRelease: tally.no_release,
        notFixedUnknownError: tally.unknown_error,
      });
      for (const track of clientTracks.values()) allClientTracks.push(track);
      if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
    }
  }

  StatusBar.finish();
  CsvHandler.writeFullExecutionStats(executionStats, finalStats, resultDir, dateStr);
  CsvHandler.writeClientTracks(allClientTracks, resultDir, dateStr);
  CsvHandler.writeExcludedClients(allExcludedClients, resultDir, dateStr);
}

// ==========================================
// Partial モード
// ==========================================

async function runPartialMode(): Promise<void> {
  const C = CONFIG.PARTIAL;

  // DETECT_MODE に対応する RBC ルートを解決（.5 モードは整数部のルートを流用）
  const rbcRoot = [C.RBC_M0, C.RBC_M1, C.RBC_M2][EFFECTIVE_DETECT_MODE];
  if (!rbcRoot) {
    console.error(`[Error] CONFIG.PARTIAL.RBC_M${EFFECTIVE_DETECT_MODE} が未設定です。detect.ts の CONFIG を確認してください。`);
    StatusBar.finish();
    return;
  }
  // .5 モード もしくは VARIANT=no_unknown のとき _no_unknown サブディレクトリを参照
  const suffix = (C.VARIANT === 'no_unknown' || FORCE_NO_UNKNOWN) ? '_no_unknown' : '';
  const cpDir = `createPattern${suffix}`;
  const dpDir = `detectByPattern${suffix}`;
  const resultDir = path.resolve(C.RESULT_BASE_DIR, DETECT_MODE_DIR);

  if (!fs.existsSync(C.TASK_LIST_PATH)) {
    console.error(`[Error] ${C.TASK_LIST_PATH} は Partial モードで必須です。`);
    StatusBar.finish();
    return;
  }

  const rawTaskList = JSON.parse(fs.readFileSync(C.TASK_LIST_PATH, 'utf-8')) as {
    libName: string; preVersion?: string; postVersion: string;
  }[];
  if (rawTaskList.length === 0) { StatusBar.finish(); return; }

  const dateStr = RUN_ID + '-partial';
  const summaryOutDir = path.resolve(resultDir, dateStr, 'specific-commits');
  OutputJson.createDir(summaryOutDir);

  const executionStats: ExtendedExecutionStat[] = [];
  const finalStats: any[] = []; // クライアント最終状態からのクリーン集計 (condensed 用)
  const allClientTracks: ClientTrack[] = [];
  const allExcludedClients: ExcludedClient[] = [];
  const totalSteps = rawTaskList.length * C.STATES.length;
  let currentStep = 0;

  for (const task of rawTaskList) {
    const { libName, postVersion } = task;
    const preVersion = task.preVersion || 'unknown';
    if (!libName || !postVersion) continue;

    const verKey = postVersion.replace(/[^a-zA-Z0-9]/g, '');

    for (const targetState of C.STATES) {
      currentStep++;
      const pct = ((currentStep / totalSteps) * 100).toFixed(1);
      StatusBar.update(`⏳ [${currentStep}/${totalSteps} (${pct}%)] Processing: ${libName} (${targetState})`);

      const recordEmptyStats = (rAll = 0, rSuc = 0, rFail = 0) => {
        const phases = [
          'update',
          ...Array.from({ length: Math.min(3, C.MAX_RELEASES_TO_TRACK) }, (_, i) => `release_${i + 1}`)
        ];
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

      // 履歴 JSON の特定 (full と同じパス構造) / partial に無ければ full の出力にフォールバック
      let stateDataDir = path.join(C.VERSION_DATA_DIR, `${libName}@${postVersion}`, targetState);
      if (!fs.existsSync(stateDataDir) && C.VERSION_DATA_DIR_FALLBACK) {
        const fallback = path.join(C.VERSION_DATA_DIR_FALLBACK, `${libName}@${postVersion}`, targetState);
        if (fs.existsSync(fallback)) stateDataDir = fallback;
      }
      if (!fs.existsSync(stateDataDir)) continue;

      const dirFiles = fs.readdirSync(stateDataDir);
      const historyFileName = dirFiles.find(f =>
        f.startsWith(`version_history-${targetState}`) && f.endsWith('.json')
      );
      if (!historyFileName) continue;
      const targetHistoryPath = path.join(stateDataDir, historyFileName);

      // RBC ファイルの特定
      const rbcTargetDir = path.resolve(rbcRoot, `${libName}_${verKey}`);
      if (!fs.existsSync(rbcTargetDir)) continue;

      const localRbcFiles = (await GetAllFiles.getRecursively(rbcTargetDir))
        .filter(f => f.includes(`/${cpDir}/`) || f.includes(`/${dpDir}/`));
      const successDetectFile = localRbcFiles.find(f => f.endsWith('success_detect.json'));
      const failureDetectFile = localRbcFiles.find(f => f.endsWith('failure_detect.json'));
      const loadedPatterns = loadPatterns(localRbcFiles, EFFECTIVE_DETECT_MODE);
      if (!loadedPatterns) continue;

      const currentDetectFile = targetState === 'success' ? successDetectFile : failureDetectFile;
      if (!currentDetectFile) continue; // failure の detect ファイルがなければスキップ

      let rbcPatternCountSuccess = 0, rbcPatternCountFailure = 0;
      if (successDetectFile) {
        try {
          rbcPatternCountSuccess =
            Number((JSON.parse(fs.readFileSync(successDetectFile, 'utf-8')) as ExtendedDetectionOutput).totalClients) || 0;
        } catch { /* ignore */ }
      }
      if (failureDetectFile) {
        try {
          rbcPatternCountFailure =
            Number((JSON.parse(fs.readFileSync(failureDetectFile, 'utf-8')) as ExtendedDetectionOutput).totalClients) || 0;
        } catch { /* ignore */ }
      }
      const rbcPatternCountAll = rbcPatternCountSuccess + rbcPatternCountFailure;
      if (rbcPatternCountAll === 0) continue;

      let rbcMatchedClients: string[] = [];
      try {
        const d = JSON.parse(fs.readFileSync(currentDetectFile, 'utf-8')) as ExtendedDetectionOutput;
        if (Array.isArray(d.detectedClients)) rbcMatchedClients = d.detectedClients;
      } catch { /* ignore */ }

      const filteredHistory = GetMatchedClients.filterByMode(targetHistoryPath, rbcMatchedClients);
      const rawTargets = TargetCommits.get(filteredHistory, libName, postVersion);

      const uniqueTargetsMap = new Map<string, any>();
      for (const t of rawTargets) {
        if (!uniqueTargetsMap.has(t.C_client)) uniqueTargetsMap.set(t.C_client, t);
      }
      const targets = Array.from(uniqueTargetsMap.values());

      const targetedSet = new Set(targets.map((t: any) => t.C_client));
      for (const c of rbcMatchedClients) {
        if (!targetedSet.has(c)) {
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
      fs.writeFileSync(commitLogPath, JSON.stringify(
        targets.map((t: any) => ({
          client: t.C_client, libVersion: t.L_postLibVersion,
          commitID: t.C_commitID, tagCommitID: t.C_tagCommitID
        })), null, 2
      ));

      const { patterns } = loadedPatterns;
      const baseFolderName = `${libName}-${postVersion}_${targetState}`;
      const baseClonePath = path.resolve(C.BASE_CLONE_DIR, baseFolderName);
      const baseResultPath = path.resolve(resultDir, dateStr, 'results', baseFolderName);

      if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
      OutputJson.createDir(baseClonePath);

      const clientStatus = new Map<string, 'active' | 'fixed' | 'downgraded' | 'no_release' | 'unknown_error'>();
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

        let activeAnalyzedCount = 0, cloneSuccessCount = 0;
        let downgradeCount = 0, noReleaseCount = 0, unknownErrorCount = 0;

        for (const item of targets) {
          const track = clientTracks.get(item.C_client)!;
          let currentStatus = clientStatus.get(item.C_client);
          let targetHash = '';
          let currentLibVer = postVersion;

          if (phaseIndex === -1) {
            targetHash = item.C_commitID;
            currentLibVer = item.L_postLibVersion || postVersion;
          } else {
            const clientData = filteredHistory.find((c: any) => c.C_client === item.C_client);
            const ver = clientData?.verList?.find((v: any) => v.C_commitID === item.C_commitID);

            let releases: any[] = [];
            if (ver && Array.isArray(ver.C_releases) && ver.C_releases.length > 0) {
              releases = ver.C_releases as any[];
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
            if (!currentLibVer || currentLibVer === 'unknown' || currentLibVer === 'not_found') {
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

          if (phaseName === 'update')    track.Update_LibVer = currentLibVer || '-';
          if (phaseName === 'release_1') track.R1_LibVer     = currentLibVer || '-';
          if (phaseName === 'release_2') track.R2_LibVer     = currentLibVer || '-';
          if (phaseName === 'release_3') track.R3_LibVer     = currentLibVer || '-';

          if (currentStatus !== 'active') {
            // 'fixed' は前フェーズで修正済み → カウントせずスキップ
            if (currentStatus === 'downgraded')    downgradeCount++;
            if (currentStatus === 'no_release')    noReleaseCount++;
            if (currentStatus === 'unknown_error') unknownErrorCount++;
            continue;
          }

          activeAnalyzedCount++;
          const sourcePath = resolveSourcePath(C.SOURCE_CLIENT_REPOS, libName, item.C_client);
          const destPath = path.resolve(absCloneDir, item.C_client);
          if (!fs.existsSync(absCloneDir)) OutputJson.createDir(absCloneDir);
          if (checkoutToDir(sourcePath, destPath, targetHash)) cloneSuccessCount++;
        }

        let detectedClientsCount = 0;
        const detectedClients = new Set<string>();
        if (cloneSuccessCount > 0) {
          OutputJson.createDir(absOutDir);
          await detectByPattern(relativeCloneDir, libName, patterns, absOutDir, true, EFFECTIVE_DETECT_MODE);

          const detectJsonPath = path.join(absOutDir, `${phaseName}_detect.json`);
          if (fs.existsSync(detectJsonPath)) {
            try {
              const dd = JSON.parse(fs.readFileSync(detectJsonPath, 'utf-8')) as ExtendedDetectionOutput;
              if (Array.isArray(dd.detectedClients)) {
                const rbcSet = new Set(dd.detectedClients);
                for (const item of targets) {
                  if (rbcSet.has(item.C_client)) detectedClients.add(item.C_client);
                }
              }
            } catch { /* ignore */ }
          }
          detectedClientsCount = detectedClients.size;
        }

        for (const item of targets) {
          const track = clientTracks.get(item.C_client)!;
          const st = clientStatus.get(item.C_client);
          let statusStr = '-';
          if      (st === 'downgraded')    statusStr = 'Downgraded (Rolled Back)';
          else if (st === 'no_release')    statusStr = 'No Release';
          else if (st === 'unknown_error') statusStr = 'Unknown Error';
          else if (st === 'fixed')         statusStr = 'Fixed (Impl Changed)';
          else if (st === 'active') {
            const destPath = path.resolve(absCloneDir, item.C_client);
            if (!fs.existsSync(destPath)) {
              statusStr = 'Clone Failed';
            } else if (detectedClients.has(item.C_client)) {
              statusStr = 'Not Fixed (Pattern Detected)';
            } else {
              statusStr = 'Fixed (Impl Changed)';
              clientStatus.set(item.C_client, 'fixed'); // 後続フェーズで再カウントしない
            }
          }
          if (phaseName === 'update')    track.Update_Status = statusStr;
          if (phaseName === 'release_1') track.R1_Status     = statusStr;
          if (phaseName === 'release_2') track.R2_Status     = statusStr;
          if (phaseName === 'release_3') track.R3_Status     = statusStr;
        }

        executionStats.push({
          library: libName, preVersion, postVersion, state: targetState, phase: phaseName,
          rbcTotalPatternCount: 0,
          rbcPatternCountAll, rbcPatternCountSuccess, rbcPatternCountFailure,
          targetUpdatedClients: targets.length, activeAnalyzed: activeAnalyzedCount,
          notFixed_PatternDetected: detectedClientsCount,
          fixed_ImplementationChanged: Math.max(0, activeAnalyzedCount - detectedClientsCount),
          downgraded: downgradeCount, noRelease: noReleaseCount, unknownError: unknownErrorCount
        });

        if (fs.existsSync(absCloneDir)) fs.rmSync(absCloneDir, { recursive: true, force: true });
      };

      await runAnalysis('update', -1);
      for (let i = 0; i < Math.min(3, C.MAX_RELEASES_TO_TRACK); i++) {
        await runAnalysis(`release_${i + 1}`, i);
      }

      // クライアント最終状態(排他)からクリーンに集計: Updated = Fixed + Downgraded + NotFixed
      const tally: Record<string, number> = { fixed: 0, downgraded: 0, no_release: 0, unknown_error: 0, active: 0 };
      for (const st of clientStatus.values()) tally[st] = (tally[st] ?? 0) + 1;
      finalStats.push({
        library: libName, preVersion, postVersion, state: targetState,
        rbcDetected: targetState === 'success' ? rbcPatternCountSuccess : rbcPatternCountFailure,
        updated: targets.length,
        fixed: tally.fixed,
        downgraded: tally.downgraded,
        notFixed: tally.active + tally.no_release + tally.unknown_error,
        notFixedStillDetected: tally.active,
        notFixedNoRelease: tally.no_release,
        notFixedUnknownError: tally.unknown_error,
      });
      for (const track of clientTracks.values()) allClientTracks.push(track);
      if (fs.existsSync(baseClonePath)) fs.rmSync(baseClonePath, { recursive: true, force: true });
    }
  }

  StatusBar.finish();
  CsvHandler.writeFullExecutionStats(executionStats, finalStats, resultDir, dateStr);
  CsvHandler.writeClientTracks(allClientTracks, resultDir, dateStr);
  CsvHandler.writeExcludedClients(allExcludedClients, resultDir, dateStr);
}

(async () => {
  console.log(`\n==================================================`);
  console.log(`[Mode] ${MODE.toUpperCase()}  [DetectMode] ${DETECT_MODE}`);
  console.log(`==================================================`);

  if (MODE === 'full') {
    await runFullMode();
  } else if (MODE === 'partial') {
    await runPartialMode();
  } else {
    console.error(`[Error] 不明なモード: "${MODE}". "full" または "partial" を指定してください。`);
    StatusBar.finish();
    process.exit(1);
  }
})();
