import { Item } from "../types/Item";
import { extractVersion } from "../core/extractVersion";
import { loadJsonData_Item } from "../utils/loadJson";
import fs from "fs";
import path from "path";
import output_json from "../utils/output_json";
import { Client_Ver } from "../types/VersionCommits";

// // 特定のライブラリを使用しているクライアントのバージョン履歴を抽出する
// (async () => {
//     const data:Item[] = await loadJsonData_Item('');
//     const libName = 'uuid';
//     // ライブラリ単位での収集
//     let client_list = data.filter(item => item.L__nameWithOwner.includes(libName)).map(item => item.S__nameWithOwner);
//     client_list = [...new Set(client_list)];
//     let verHistory:Client_Ver[] = await extractVersion(client_list,libName);

//     const now = new Date();
//     const date = output_json.formatDateTime(now);
//     let outputDir:string = '';
//     outputDir = path.resolve(process.cwd(), '../output/versionData/' + date + '/' + libName + '-' + 'all');
//     output_json.createOutputDirectory(outputDir);
//     let outputPath = 'file1';
//     outputPath = output_json.getUniqueOutputPath(outputDir, 'version_history',client_list.length.toString());
//     // JSONデータをファイルに書き込む
//     console.log('outputPath：',outputPath);
//     fs.writeFileSync(outputPath, JSON.stringify(verHistory, null, 2));
// })();

// 例: 特定のライブラリ，バージョンのクライアントを収集 
(async () => {
  // 手動設定
  // let state = "success";
  let state = "failure";
  // ライブラリとバージョン範囲のリスト
  // const libVersionRanges = JSON.parse(fs.readFileSync('../datasets/mydata/mydata.json', 'utf-8'));
  const libVersionRanges = JSON.parse(fs.readFileSync('../datasets/mydata/testData.json', 'utf-8'));
  const data: Item[] = await loadJsonData_Item('../datasets/test_result.json');


  const now = new Date();
  const date = output_json.formatDateTime(now);

  for (const { libName, preVersion, postVersion } of libVersionRanges) {
    // 特定のライブラリ，バージョンのクライアントを収集
    let list1: string[] = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(preVersion) && item.state.includes("success")).map(item => item.S__nameWithOwner);
    let list2: string[] = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(postVersion) && item.state.includes(state)).map(item => item.S__nameWithOwner);
    let client_list = list2.filter(value => list1.includes(value));
    client_list = [...new Set(client_list)]
    let verHistory = await extractVersion(client_list, libName, postVersion, state);

    // 出力先のパスを取得
    let outputDir: string = '';
    outputDir = path.resolve(process.cwd(), '../output/versionData/' + date + '/' + libName + '-' + postVersion);
    output_json.createOutputDirectory(outputDir);

    let outputPath = 'file1';
    outputPath = output_json.getUniqueOutputPath(outputDir, 'version_history-' + state, client_list.length.toString());
    // JSONデータをファイルに書き込む
    console.log('outputPath：', outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(verHistory, null, 2));
  }
})();