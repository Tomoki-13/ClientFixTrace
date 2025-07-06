import { Item } from "./types/Item";
import { extractVersion } from "./core/extractVersion";
import { loadJsonData_Item } from "./utils/loadJson";
import fs from "fs";

// // 特定のライブラリを使用しているクライアントのバージョン履歴を抽出する
// (async () => {
//     const data:Item[] = await loadJsonData_Item('');
//     const libName = 'uuid';
//     // ライブラリ単位での収集
//     let client_list = data.filter(item => item.L__nameWithOwner.includes(libName)).map(item => item.S__nameWithOwner);
//     client_list = [...new Set(client_list)];
//     extractVersion(client_list,libName);
// })();


interface data_Item {
  L__nameWithOwner: string;
  L__version: string;
  S__nameWithOwner: string;
}

// 例: 特定のライブラリ，バージョンのクライアントを収集 
(async () => {
    const data:Item[] = await loadJsonData_Item('../datasets/mydata/mydata.JSON');
    // 手動設定
    let state = "success";
    // ライブラリとバージョン範囲のリスト
    const libVersionRanges = JSON.parse(fs.readFileSync('lib_versions.json', 'utf-8'));

    for (const { libName, preVersion, postVersion } of libVersionRanges) {
        // 特定のライブラリ，バージョンのクライアントを収集
        let list1:string[] = data.filter(item => item.L__nameWithOwner.includes(libName)&&item.L__version.includes(preVersion)&&item.state.includes(state)).map(item => item.S__nameWithOwner);
        let list2:string[] = data.filter(item => item.L__nameWithOwner.includes(libName)&&item.L__version.includes(postVersion)&&item.state.includes(state)).map(item => item.S__nameWithOwner);
        let client_list = list2.filter(value => list1.includes(value));
        extractVersion(client_list,libName);
    }
})();