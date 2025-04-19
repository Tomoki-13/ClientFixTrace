import { Item } from "./types/Item";
import { loadJsonData_Item } from "./utils/loadJson";
import { extractVersion } from "./core/extractVersion";
import { Client_Ver } from "./types/VersionCommits";
import { VersionPair } from "./types/VersionPair";
import { create_version_pairs } from "./core/create_version_pairs";

(async () => {
    const data:Item[] = await loadJsonData_Item('../datasets/test_result.json');
    // const data:Item[] = await loadJsonData_Item('../datasets/sample.json');
    const libName = 'uuid';
    // ライブラリを使用しているクライアントのリストを取得
    let client_list = data.filter(item => item.L__nameWithOwner.includes(libName)).map(item => item.S__nameWithOwner);
    console.log(client_list.length);
    client_list = [...new Set(client_list)];
    console.log(client_list.length);
    //extractVersionでクライアントを200に制限
    let verData:Client_Ver[] = await extractVersion(client_list,libName);
    let verPairs:string[][] = [];
    verData.forEach((element) => {
        let tmp_strArray:string[] = [];
        element.verList.forEach((ver) => {
            tmp_strArray.push(ver.version);
        });
        verPairs.push(tmp_strArray);
    });
    console.log('VerPairs:', verPairs);
    let pairs:VersionPair[] = create_version_pairs(verPairs,libName);
    console.log(pairs);
})();