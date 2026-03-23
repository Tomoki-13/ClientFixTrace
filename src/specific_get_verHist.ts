import fs from "fs";
import path from "path";
import { Item } from "./types/Item";
import { loadJsonData_Item, loadJsonData_Client_Ver } from "./utils/loadJson";
import { extractVersion } from "./core/extractVersion";
import { create_version_pairs } from "./core/create_version_pairs";
import { extractVersionList } from "./utils/arrayOperation";
import output_json from "./utils/output_json";
import { VersionPair } from "./types/VersionPair";

type RunMode = 'extract' | 'analyze' | 'full';

/**
 * ライブラリ解析タスクのメイン制御関数
 * @param libTask    - ライブラリ名やターゲットバージョンの情報
 * @param targetPath - (analyze時のみ) 読み込む既存の履歴JSONパス
 * @param mode       - 実行モード (extract / analyze / full)
 * @param state      - 解析対象の状態 (success / failure)
 * @param dateStr    - 出力フォルダ用の日付文字列
 */
async function processLibraryTask(libTask: any, targetPath: string = "", mode: RunMode, state: string, dateStr: string) {
  const { libName, preVersion, postVersion } = libTask;

  // 保存先: ../output/versionData/{日時}/{状態}/{ライブラリ-バージョン}
  const outputDir = path.resolve(process.cwd(), `../output/versionData/${dateStr}/${state}/${libName}-${postVersion}`);
  let verHistory: any[] = [];
  let population = 0;

  // --- STEP 1: データ抽出 (Extract) ---
  // modeが 'full' か 'extract' の場合のみ実行。重い処理。
  if (mode === 'extract' || mode === 'full') {
    console.log(`[Extract] Loading dataset for ${libName}...`);
    const data: Item[] = await loadJsonData_Item('../datasets/test_result.json');

    // 条件に合うリポジトリを抽出 (旧Verから新Verへ遷移し、かつ指定の状態であるもの)
    let list1 = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(preVersion) && item.state.includes("success")).map(item => item.S__nameWithOwner);
    let list2 = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(postVersion) && item.state.includes(state)).map(item => item.S__nameWithOwner);

    // 重複を排除したクライアントリスト
    let client_list = [...new Set(list2.filter(value => list1.includes(value)))];
    population = client_list.length;

    if (population > 0) {
      // クライアントごとの詳細なバージョン履歴（コミットID等）を抽出
      verHistory = await extractVersion(client_list, libName, postVersion, state);
      output_json.createOutputDirectory(outputDir);
      const historyPath = output_json.getUniqueOutputPath(outputDir, `version_history-${state}`, `${population}total`);
      fs.writeFileSync(historyPath, JSON.stringify(verHistory, null, 2));
      console.log(`[Extract] Saved ${population} histories.`);
    }
  }

  // --- STEP 2: 集計・分類 (Analyze) ---
  // modeが 'full' か 'analyze' の場合のみ実行。
  if (mode === 'analyze' || mode === 'full') {
    // analyzeモードかつ、過去のファイルが指定されている場合はそれを読み込む (抽出をスキップ)
    if (mode === 'analyze' && targetPath.length > 0) {
      console.log(`[Analyze] Loading existing file: ${targetPath}`);
      verHistory = await loadJsonData_Client_Ver(targetPath);
      population = verHistory.length;
    }

    if (verHistory.length > 0) {
      // 履歴から「どのVerからどのVerへ上げたか」のペアを作成し集計
      const inputList = extractVersionList(verHistory);
      const pairs = create_version_pairs(inputList, libName, 1);

      // 統計情報の計算
      const updateCount = pairs.filter(p => p.type === 'update').reduce((sum, p) => sum + p.count, 0);
      const countSuffix = `${updateCount}updated-${population}total`;

      const pairPath = output_json.getUniqueOutputPath(outputDir, `result_pairs-${state}`, countSuffix);
      fs.writeFileSync(pairPath, JSON.stringify(pairs, null, 2));

      // 種別（update / downgrade / same）ごとにファイルを分けて保存
      Classify_types(pairs, libName, postVersion, dateStr, state, countSuffix);
      console.log(`[Analyze] Classification completed: ${countSuffix}`);
    }
  }
}

/**
 * バージョンペアをタイプ別にフォルダ分けして保存する
 */
function Classify_types(data: VersionPair[], libName: string, postLibVersion: string, dateStr: string, state: string, countSuffix: string): void {
  data = [...data].sort((a, b) => b.count - a.count);
  let outDir = path.join('../output/sortData', dateStr, state, `${libName}-${postLibVersion}`);
  output_json.createOutputDirectory(outDir);

  const types: ('update' | 'downgrade' | 'same')[] = ['update', 'downgrade', 'same'];
  types.forEach(type => {
    const filteredData = data.filter((item) => item.type === type);
    const outputPath = output_json.getUniqueOutputPath(outDir, '', `${type}_${countSuffix}`);
    fs.writeFileSync(outputPath, JSON.stringify(filteredData, null, 2));
  });
}

// ==========================================
// 実行セクション
// ==========================================

(async () => {
  const myDataPath = '../datasets/mydata/mydata.json';
  const libVersionRanges = JSON.parse(fs.readFileSync(myDataPath, 'utf-8'));
  const now = new Date();
  const dateStr = output_json.formatDateTime(now);

  const mode: RunMode = 'full';
  const states = ['success', 'failure'];

  for (const st of states) {
    for (const task of libVersionRanges) {
      console.log(`\nStarting Full Task: ${task.libName} (${st})`);
      await processLibraryTask(task, "", mode, st, dateStr);
    }
  }

  // ---------------------------------------------------------
  // パターンB: 【Analyze実行】既存のデータを使って分類だけやり直す
  // 抽出が済んでいる場合、下のコメントを解除して上のFull実行をコメントアウトする
  // ---------------------------------------------------------
  // const mode: RunMode = 'analyze';
  // const historyPath = '../output/versionData/2026-03-01-12-00-00/success/libname/version_history-success-100total.json'; // 既存の履歴ファイルパス
  // const task = libVersionRanges[0]; // 対象のタスク
  // await processLibraryTask(task, historyPath, mode, 'success', dateStr);
})();