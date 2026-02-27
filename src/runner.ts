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
  const now = new Date();

  const outputDir = path.resolve(process.cwd(), `../output/versionData/${dateStr}/${libName}-${postVersion}`);
  let verHistory: any[] = [];

  // 1: 抽出 (extract または full)
  if (mode === 'extract' || mode === 'full') {
    const data: Item[] = await loadJsonData_Item('../datasets/test_result.json');

    // 特定バージョンの遷移を確認できたクライアントのみを抽出
    let list1 = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(preVersion) && item.state.includes("success")).map(item => item.S__nameWithOwner);
    let list2 = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(postVersion) && item.state.includes(state)).map(item => item.S__nameWithOwner);
    let client_list = [...new Set(list2.filter(value => list1.includes(value)))];

    if (client_list.length > 0) {
      verHistory = await extractVersion(client_list, libName, postVersion, state);
      output_json.createOutputDirectory(outputDir);
      const historyPath = output_json.getUniqueOutputPath(outputDir, `version_history-${state}`, client_list.length.toString());
      fs.writeFileSync(historyPath, JSON.stringify(verHistory, null, 2));
    }
  }

  // 2: 解析・分類 (analyze または full) 
  if (mode === 'analyze' || mode === 'full') {
    if (mode as RunMode === 'analyze' && targetPath.length > 0) {
      verHistory = await loadJsonData_Client_Ver(targetPath);
    }

    if (verHistory.length > 0) {
      const inputList = extractVersionList(verHistory);
      const pairs = create_version_pairs(inputList, libName, 1);

      const pairPath = output_json.getUniqueOutputPath(outputDir, `result_pairs-${state}`, "");
      fs.writeFileSync(pairPath, JSON.stringify(pairs, null, 2));

      Classify_types(pairs, libName, postVersion, dateStr);
    }
  }
}

(async () => {
  // const myDataPath = '../datasets/mydata/testData.json';
  const myDataPath = '../datasets/mydata/mydata.json';
  let targetDir: string[] = []
  const libVersionRanges = JSON.parse(fs.readFileSync(myDataPath, 'utf-8'));
  const mode: RunMode = 'full' as RunMode;
  const state = 'failure';
  let num = 0;
  const now = new Date();
  const dateStr = output_json.formatDateTime(now);

  for (const task of libVersionRanges) {
    console.log(`Starting task: ${task.libName} (${task.preVersion} -> ${task.postVersion})`);
    if (mode == 'analyze') {
      await processLibraryTask(task, targetDir[num], mode, state, dateStr);
    } else {
      await processLibraryTask(task, "", mode, state, dateStr);
    }
    num++;
  }
})();


function Classify_types(data: VersionPair[], libName: string, postLibVersion: string = '0', dateStr: string): void {
  data = [...data].sort((a, b) => b.count - a.count);
  let outDir = path.join('../output/sortData', dateStr, `${libName}-${postLibVersion}`);
  output_json.createOutputDirectory(outDir);

  //種別によるフィルタリング
  data.filter((item) => item.type === 'update');
  console.log(output_json.getUniqueOutputPath(outDir, '', 'update'));
  fs.writeFileSync(output_json.getUniqueOutputPath(outDir, '', 'update'), JSON.stringify(data.filter((item) => item.type === 'update'), null, 2));

  data.filter((item) => item.type === 'downgrade');
  fs.writeFileSync(output_json.getUniqueOutputPath(outDir, '', 'downgrade'), JSON.stringify(data.filter((item) => item.type === 'downgrade'), null, 2));

  data.filter((item) => item.type === 'same');
  fs.writeFileSync(output_json.getUniqueOutputPath(outDir, '', 'same'), JSON.stringify(data.filter((item) => item.type === 'same'), null, 2));
}
