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

async function processLibraryTask(libTask: any, targetPath: string = "", mode: RunMode, state: string, dateStr: string) {
  const { libName, preVersion, postVersion } = libTask;

  // 出力ディレクトリに state (success/failure) を追加
  const outputDir = path.resolve(process.cwd(), `../output/versionData/${dateStr}/${state}/${libName}-${postVersion}`);
  let verHistory: any[] = [];
  let population = 0;

  if (mode === 'extract' || mode === 'full') {
    const data: Item[] = await loadJsonData_Item('../datasets/test_result.json');
    let list1 = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(preVersion) && item.state.includes("success")).map(item => item.S__nameWithOwner);
    let list2 = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(postVersion) && item.state.includes(state)).map(item => item.S__nameWithOwner);
    let client_list = [...new Set(list2.filter(value => list1.includes(value)))];
    population = client_list.length;

    if (population > 0) {
      verHistory = await extractVersion(client_list, libName, postVersion, state);
      output_json.createOutputDirectory(outputDir);
      const historyPath = output_json.getUniqueOutputPath(outputDir, `version_history-${state}`, `${population}total`);
      fs.writeFileSync(historyPath, JSON.stringify(verHistory, null, 2));
    }
  }

  if (mode === 'analyze' || mode === 'full') {
    if (mode === 'analyze' && targetPath.length > 0) {
      verHistory = await loadJsonData_Client_Ver(targetPath);
      population = verHistory.length;
    }

    if (verHistory.length > 0) {
      const inputList = extractVersionList(verHistory);
      const pairs = create_version_pairs(inputList, libName, 1);
      const updateCount = pairs.filter(p => p.type === 'update').reduce((sum, p) => sum + p.count, 0);
      const countSuffix = `${updateCount}updated-${population}total`;

      const pairPath = output_json.getUniqueOutputPath(outputDir, `result_pairs-${state}`, countSuffix);
      fs.writeFileSync(pairPath, JSON.stringify(pairs, null, 2));

      // Classify_types にも state を渡すように変更
      Classify_types(pairs, libName, postVersion, dateStr, state, countSuffix);
    }
  }
}

function Classify_types(data: VersionPair[], libName: string, postLibVersion: string = '0', dateStr: string, state: string, countSuffix: string): void {
  data = [...data].sort((a, b) => b.count - a.count);
  // 分類先のディレクトリにも state を含める
  let outDir = path.join('../output/sortData', dateStr, state, `${libName}-${postLibVersion}`);
  output_json.createOutputDirectory(outDir);

  const types: ('update' | 'downgrade' | 'same')[] = ['update', 'downgrade', 'same'];
  types.forEach(type => {
    const filteredData = data.filter((item) => item.type === type);
    const outputPath = output_json.getUniqueOutputPath(outDir, '', `${type}_${countSuffix}`);
    fs.writeFileSync(outputPath, JSON.stringify(filteredData, null, 2));
  });
}

(async () => {
  const myDataPath = '../datasets/mydata/mydata.json';
  const libVersionRanges = JSON.parse(fs.readFileSync(myDataPath, 'utf-8'));
  const mode: RunMode = 'full';
  // const state = 'failure';
  const state = ['success', 'failure'];
  const now = new Date();
  const dateStr = output_json.formatDateTime(now);
  for (const st of state) {
    for (const task of libVersionRanges) {
      console.log(`Starting task: ${task.libName} (${task.preVersion} -> ${task.postVersion})`);
      // analyzeモード時のパス管理用
      await processLibraryTask(task, "", mode, st, dateStr);
    }
  }
})();

// (async () => {
//   const myDataPath = '../datasets/mydata/mydata.json';
//   const libVersionRanges = JSON.parse(fs.readFileSync(myDataPath, 'utf-8'));
//   const mode: RunMode = 'full';
//   const state = 'failure';
//   const now = new Date();
//   const dateStr = output_json.formatDateTime(now);

//   for (const task of libVersionRanges) {
//     console.log(`Starting task: ${task.libName} (${task.preVersion} -> ${task.postVersion})`);
//     // analyzeモード時のパス管理用
//     await processLibraryTask(task, "", mode, state, dateStr);
//   }
// })();