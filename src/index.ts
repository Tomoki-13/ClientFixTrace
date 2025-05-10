import { Item } from "./types/Item";
import { loadJsonData_Item } from "./utils/loadJson";
import { extractVersion } from "./core/extractVersion";
import { Client_Ver } from "./types/VersionCommits";
import { VersionPair } from "./types/VersionPair";
import { create_version_pairs } from "./core/create_version_pairs";
import path from "path";
import fs from "fs";
import output_json from "./utils/output_json";

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
        //console.log('element:',element.verList);
        if(element.verList.length > 1){
            element.verList.forEach((ver) => {
                tmp_strArray.push(ver.version);
            });
        }
        verPairs.push(tmp_strArray);
    });
    let pairs:VersionPair[] = create_version_pairs(verPairs,libName,1);
    console.log(pairs);
    Classify_types(pairs,libName);
})();

function Classify_types(data: VersionPair[], libName: string): void {
    data = [...data].sort((a, b) => b.count - a.count);
    
    
    // 例: 2025-04-19
    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    let outDir = path.join('../output/sortData', libName, date);
    output_json.createOutputDirectory(outDir);
    
    //種別によるフィルタリング
    data.filter((item) => item.type === 'update');
    console.log(output_json.getUniqueOutputPath(outDir, '','update'));
    fs.writeFileSync(output_json.getUniqueOutputPath(outDir, '','update') ,JSON.stringify(data.filter((item) => item.type === 'update'), null, 2));
    
    data.filter((item) => item.type === 'downgrade');
    fs.writeFileSync(output_json.getUniqueOutputPath(outDir, '','downgrade'), JSON.stringify(data.filter((item) => item.type === 'downgrade'), null, 2));
    
    data.filter((item) => item.type === 'same');
    fs.writeFileSync(output_json.getUniqueOutputPath(outDir, '','same'), JSON.stringify(data.filter((item) => item.type === 'same'), null, 2));
}