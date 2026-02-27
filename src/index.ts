import { Item } from "./types/Item";
import { loadJsonData_Item } from "./utils/loadJson";
import { extractVersion } from "./core/extractVersion";
import { Client_Ver } from "./types/VersionCommits";
import { VersionPair } from "./types/VersionPair";
import { create_version_pairs } from "./core/create_version_pairs";
import path from "path";
import fs from "fs";
import output_json from "./utils/output_json";
import { extractVersionList } from "./utils/arrayOperation";

(async () => {
    const data:Item[] = await loadJsonData_Item('../datasets/test_result.json');
    const libName = 'uuid';
    let preLibVersion = '7.0.3';
    let postLibVersion = '8.0.0-beta.0';
    let state = "success";


    // ライブラリを使用しているクライアントのリストを取得
    let client_list:string[] = [];
    let verHistory:Client_Ver[] = [];
    if(postLibVersion === '0') {//ライブラリ単位
        client_list = data.filter(item => item.L__nameWithOwner.includes(libName)).map(item => item.S__nameWithOwner);
        client_list = [...new Set(client_list)];
        verHistory= await extractVersion(client_list,libName);
    }else if(postLibVersion !== '0') {//バージョンごと
        if(state.length === 0 && preLibVersion.length === 0) {
            client_list = data.filter(item => item.L__nameWithOwner.includes(libName)&&item.L__version.includes(postLibVersion)).map(item => item.S__nameWithOwner);
        }else {
            let list1:string[] = data.filter(item => item.L__nameWithOwner.includes(libName)&&item.L__version.includes(preLibVersion)&&item.state.includes(state)).map(item => item.S__nameWithOwner);
            let list2:string[] = data.filter(item => item.L__nameWithOwner.includes(libName)&&item.L__version.includes(postLibVersion)&&item.state.includes(state)).map(item => item.S__nameWithOwner);
            client_list = list2.filter(value => list1.includes(value));
        }
        client_list = [...new Set(client_list)];
        verHistory= await extractVersion(client_list,libName);
    }

    // 出力先のパスを取得
    const now = new Date();
    const date = output_json.formatDateTime(now);
    let outputDir:string = '';
    if(postLibVersion){
        outputDir = path.resolve(process.cwd(), '../output/versionData/' + date + '/' + libName + '-' + postLibVersion);
    }else{
        outputDir = path.resolve(process.cwd(), '../output/versionData/' + date + '/' + libName + '-' + 'all');
    }

    let outputPath = 'file1';
    if(state && state.length > 0) {
        outputPath = output_json.getUniqueOutputPath(outputDir, 'version_history-'+state,client_list.length.toString());
    }else {
        outputPath = output_json.getUniqueOutputPath(outputDir, 'version_history',client_list.length.toString());
    }
    //const outputPath = output_json.getUniqueOutputPath(outputDir, 'version_history:',limit.toString());
    // JSONデータをファイルに書き込む
    console.log('outputPath：',outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(verHistory, null, 2));

    //バージョンペアのカウント
    let verPairs:string[][] = extractVersionList(verHistory);
    let pairs:VersionPair[] = create_version_pairs(verPairs,libName,1);
    let outputPath_pair = 'file1';
    if(state && state.length > 0) {
        outputPath = output_json.getUniqueOutputPath(outputDir, 'result_pairs-','state');
    }else {
        outputPath = output_json.getUniqueOutputPath(outputDir, 'result_pairs','');
    }
    // JSONデータをファイルに書き込む
    fs.writeFileSync(outputPath_pair, JSON.stringify(pairs, null, 2));
    console.log(pairs);

    //update, downgrade, sameの分類
    Classify_types(pairs,libName,postLibVersion);
})();

//クライアントのバージョンペアを分類する
function Classify_types(data: VersionPair[], libName: string,postLibVersion:string = '0'): void {
    data = [...data].sort((a, b) => b.count - a.count);
    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    let outDir = path.join('../output/sortData', libName+postLibVersion, date);
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
