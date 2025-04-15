import fs from "fs";
import path from 'path';
import output_json from "./utils/output_json";
import { Item } from "./types/Item";
import { cloneRepo } from "./module/cloneRepo";
import { checkoutCommit } from "./module/checkoutCommit";
import { Client_Ver } from "./types/VersionCommits";
import { loadJsonData_Item } from "./utils/loadJson";

// リポジトリを順番にクローン
export const extractVersion = async (client_list:string[],libName:string): Promise<Client_Ver[]>  => {
    let std_Dir:string = path.resolve(process.cwd(), '../clientRepos/'); 
    // 出力先ディレクトリの作成
    output_json.createOutputDirectory(std_Dir);
    // ライブラリ名のディレクトリを作成
    let cloneDir = path.join(std_Dir, libName);
    output_json.createOutputDirectory(cloneDir);

    let verHistory:Client_Ver[] = [];
    //ぞれぞれにクローン，チェックアウト，バージョン確認を実行
    for(const client of client_list) {
        try{
            let repoPath = await cloneRepo(client,cloneDir);
            let c_data:Client_Ver = await checkoutCommit(repoPath, libName);
            if(c_data) {
                verHistory =  verHistory.concat(c_data);
            }
            process.chdir(std_Dir);
        } catch (error) {
            console.error(error);
        }

    }
    console.log('verHistory:',verHistory);
    // 出力先のパスを取得

    const outputDir:string = path.resolve(process.cwd(), '../datasets/output/'); 
    output_json.createOutputDirectory(outputDir);
    const outputPath = output_json.getUniqueOutputPath(outputDir, libName, 'version_history');
    // JSONデータをファイルに書き込む
    fs.writeFileSync(outputPath, JSON.stringify(verHistory, null, 2));
    return verHistory;
};

// const data:Item[] = loadJsonData('../datasets/test_result.json');
const data:Item[] = loadJsonData_Item('../datasets/sample.json');
const libName = 'uuid';
// ライブラリを使用しているクライアントのリストを取得
let client_list = data.filter(item => item.L__nameWithOwner.includes(libName)).map(item => item.S__nameWithOwner);
client_list = [...new Set(client_list)];
console.log(extractVersion(client_list,libName));