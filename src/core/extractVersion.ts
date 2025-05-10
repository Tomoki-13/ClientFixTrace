import fs from "fs";
import path from 'path';
import output_json from "../utils/output_json";
import { cloneRepo } from "../module/cloneRepo";
import { checkoutCommit } from "../module/checkoutCommit";
import { Client_Ver } from "../types/VersionCommits";

// リポジトリを順番にクローン
export const extractVersion = async (client_list:string[],libName:string): Promise<Client_Ver[]>  => {
    //process.cwd() == src
    let std_Dir:string = path.resolve(process.cwd(), '../clientRepos/'); 
    // 出力先ディレクトリの作成
    output_json.createOutputDirectory(std_Dir);
    // ライブラリ名のディレクトリを作成 clientRepos/libName
    let cloneDir = path.join(std_Dir, libName);
    output_json.createOutputDirectory(cloneDir);
    console.log(process.cwd());
    let verHistory:Client_Ver[] = [];

    //クライアントのリストを600に制限
    let limit = 600;
    let count = 0;

    //ぞれぞれにクローン，チェックアウト，バージョン確認を実行
    for(const client of client_list) {
        try{
            let repoPath = await cloneRepo(client,cloneDir);
            let c_data:Client_Ver = await checkoutCommit(repoPath, libName);
            //バージョン数が最低でも2以上のものを取得　変更しているものに限定
            if(c_data && c_data.verList.length > 1) {
                verHistory =  verHistory.concat(c_data);
            }
            process.chdir(std_Dir);
        } catch (error) {
            console.error(error);
        }
        count++;
        console.log(`クライアントの取得を続行します。残り${limit - count}件`);
        if(count >= limit) {
            console.log(`クライアントの取得を終了します。`);
            break;
        }
    }
    // 出力先のパスを取得
    const outputDir:string = path.resolve(process.cwd(), '../output/'+libName); 
    output_json.createOutputDirectory(outputDir);
    console.log('client_list.length:',client_list.length);
    // const outputPath = output_json.getUniqueOutputPath(outputDir, 'version_history:',client_list.length.toString());
    const outputPath = output_json.getUniqueOutputPath(outputDir, 'version_history:',limit.toString());
    // JSONデータをファイルに書き込む
    fs.writeFileSync(outputPath, JSON.stringify(verHistory, null, 2));
    console.log('verHistory:',verHistory);
    return verHistory;
};