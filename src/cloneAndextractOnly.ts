import { Item } from "./types/Item";
import { extractVersion } from "./core/extractVersion";
import { loadJsonData_Item } from "./utils/loadJson";

// 特定のライブラリを使用しているクライアントのバージョン履歴を抽出する
(async () => {
    const data:Item[] = await loadJsonData_Item('');
    const libName = 'uuid';
    // ライブラリ単位での収集
    let client_list = data.filter(item => item.L__nameWithOwner.includes(libName)).map(item => item.S__nameWithOwner);
    client_list = [...new Set(client_list)];
    extractVersion(client_list,libName);
})();

// 例: 特定のライブラリ，バージョンのクライアントを収集 
// (async () => {
//     const data:Item[] = await loadJsonData_Item('');
//     const libName = 'uuid';
//     // 特定のライブラリ，バージョンのクライアントを収集
//     let client_list = data.filter(item => item.L__nameWithOwner.includes(libName)&&item.L__version.includes("7.0.0-beta.0")&&item.state.includes("success")).map(item => item.S__nameWithOwner);
//     console.log('全体:',client_list.length);
//     client_list = [...new Set(client_list)];
//     extractVersion(client_list,libName);
// })();