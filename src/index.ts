import fs from "fs";
import path from 'path';
import output_json from "./utils/output_json";
import { Item } from "./types/Item";
import { cloneRepo } from "./utils/cloneRepo";
import { checkoutCommit } from "./utils/checkoutCommit";

const loadJsonData = (filePath: string): Item[] => {
    const jsonData = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(jsonData) as Item[];
};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// リポジトリを順番にクローン
const analyze = async (client_list:string[],libName:string): Promise<boolean>  => {
    let std_Dir:string = path.resolve(process.cwd(), '../clientRepos/'); 
    // 出力先ディレクトリの作成
    output_json.createOutputDirectory(std_Dir);
    // ライブラリ名のディレクトリを作成
    let cloneDir = path.join(std_Dir, libName);
    output_json.createOutputDirectory(cloneDir);
    //ぞれぞれにクローン，チェックアウト，バージョン確認を実行
    for(const client of client_list) {
        try{
            let repoPath = await cloneRepo(client,cloneDir);
            console.log(checkoutCommit(repoPath, libName));
            process.chdir(std_Dir);
        } catch (error) {
            console.error(error);
        }
    }
    return false;
};


// const data:Item[] = loadJsonData('../datasets/test_result.json');
const data:Item[] = loadJsonData('../datasets/sample.json');
const libName = 'uuid';
// ライブラリを使用しているクライアントのリストを取得
let client_list = data.filter(item => item.L__nameWithOwner.includes(libName)).map(item => item.S__nameWithOwner);

console.log(client_list.length);
client_list = [...new Set(client_list)];
console.log(client_list.length);
analyze(client_list,libName);