import { loadJsonData_Client_Ver } from "../utils/loadJson";
import { Client_Ver } from "../types/VersionCommits";
import { VersionPair } from "../types/VersionPair";
import { create_version_pairs } from "../core/create_version_pairs";
import output_json from "../utils/output_json";
import path from "path";
import { extractVersionList } from "../utils/arrayOperation";

(async () => {
  const libName = 'uuid';
  let filePath: string = '../output/versionData/2026-02-20-17-28-36/vinyl-2.0.0/version_history-failure_13.json';
  let state: string = 'failure';
  let postLibVersion = 'vinyl-2.0.0';

  //cloneAndextractOnly.tsで取得したクライアントのバージョン履歴を読み込む
  const data: Client_Ver[] = await loadJsonData_Client_Ver(filePath);
  //inputList：[[クライアントごと],[...]]全体のバージョン履歴 クライアントのないでの重複も含む
  let inputList: string[][] = [];
  inputList = extractVersionList(data);
  let pairs: VersionPair[] = create_version_pairs(inputList, libName, 1);
  console.log('result_pairs:', pairs);

  // 出力先のパスを取得
  const now = new Date();
  const date = output_json.formatDateTime(now);
  let outputDir: string = '';
  if (postLibVersion) {
    outputDir = path.resolve(process.cwd(), '../output/versionData/' + date + '/' + libName + '-' + postLibVersion);
  } else {
    outputDir = path.resolve(process.cwd(), '../output/versionData/' + date + '/' + libName + '-' + 'all');
  }

  let outputPath_pair = 'file1';
  let str = filePath.split('/').pop();
  if (state && state.length > 0 && str) {
    outputPath_pair = output_json.getUniqueOutputPath(outputDir, str, 'result_pairs-' + 'state');
  } else {
    outputPath_pair = output_json.getUniqueOutputPath(outputDir, 'result_pairs', '');
  }
  // fs.writeFileSync(outputPath_pair, JSON.stringify(pairs, null, 2));
})();