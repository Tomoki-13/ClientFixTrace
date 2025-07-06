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
    let preLibVersion = '7.0.3';
    let libVersion = '8.0.0-beta.0';
    let state = "success";


    // ライブラリを使用しているクライアントのリストを取得
    let client_list:string[] = [];
    let verData:Client_Ver[] = [];
    if(libVersion === '0') {//ライブラリ単位
        client_list = data.filter(item => item.L__nameWithOwner.includes(libName)).map(item => item.S__nameWithOwner);
        client_list = [...new Set(client_list)];
        verData = await extractVersion(client_list,libName);
    }else if(libVersion !== '0') {//バージョンごと
        if(state.length === 0 && preLibVersion.length === 0) {
            client_list = data.filter(item => item.L__nameWithOwner.includes(libName)&&item.L__version.includes(libVersion)).map(item => item.S__nameWithOwner);
        }else {
            let list1:string[] = data.filter(item => item.L__nameWithOwner.includes(libName)&&item.L__version.includes(preLibVersion)&&item.state.includes(state)).map(item => item.S__nameWithOwner);
            let list2:string[] = data.filter(item => item.L__nameWithOwner.includes(libName)&&item.L__version.includes(libVersion)&&item.state.includes(state)).map(item => item.S__nameWithOwner);
            client_list = list2.filter(value => list1.includes(value));
        }
        client_list = [...new Set(client_list)];
        verData = await extractVersion(client_list,libName);
    }

    let outputDir:string = path.resolve(process.cwd(), '../output/cloneAndextractOnly_result/'+libName);
    output_json.createOutputDirectory(outputDir);
    if(libVersion !== '0') {
        outputDir = path.join(outputDir, libVersion.toString());
        output_json.createOutputDirectory(outputDir);
    }
    let outputPath = '';
    if(state.length === 0) {
        output_json.getUniqueOutputPath(outputDir, 'version_history:',client_list.length.toString()+'-'+state);
    }
    fs.writeFileSync(outputPath, JSON.stringify(verData, null, 2));

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

    //update, downgrade, sameの分類
    Classify_types(pairs,libName,libVersion);
})();

//クライアントのバージョンペアを分類する
function Classify_types(data: VersionPair[], libName: string,libVersion:string = '0'): void {
    data = [...data].sort((a, b) => b.count - a.count);
    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    let outDir = path.join('../output/sortData', libName+libVersion, date);
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
