import fs from "fs";
import path from 'path';
import output_json from "../utils/output_json";
import { cloneRepo } from "../module/cloneRepo";
import { checkoutCommit } from "../module/checkoutCommit";
import { Client_Ver } from "../types/VersionCommits";

// リポジトリを順番にクローン
//libVersionはファイル名を変更するためだけに使用(client_listでフィルタリング済み)
export const extractVersion = async (client_list:string[],libName:string,libNum:string = '0',state:string = ''):
    Promise<Client_Ver[]> => {
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
    let limit = 1;
    let count = 0;

    //ぞれぞれにクローン，チェックアウト，バージョン確認を実行
    for(const client of client_list) {
        // if(count >= limit) { // ここを >= に変更するか
        //     console.log(`クライアントの取得を終了します。`);
        //     break;
        // }else{
        //     console.log(`クライアントの取得を続行します。残り${limit - count}件`);
        // }
        try{
            let repoPath = await cloneRepo(client,cloneDir);
            if (!repoPath) {
                console.warn(`clone failure: ${client}`);
                continue;
            }
            let c_data:Client_Ver = await checkoutCommit(repoPath, libName);
            //バージョン数が最低でも2以上のものを取得　変更しているものに限定
            if(c_data && c_data.verList.length > 1) {
                verHistory =  verHistory.concat(c_data);
            }
            process.chdir(std_Dir);
            count++;
        } catch (error) {
            console.error(error);
            count++;
        }
    }

    // 出力先のパスを取得
    const now = new Date();
    const date = formatDateTimeForFilename(now);
    let outputDir:string = '';
    if(libNum){
        outputDir = path.resolve(process.cwd(), '../output/cloneAndextractOnly_result/'+libName + '/' + libNum+'/'+date);
        output_json.createOutputDirectory(outputDir);
    }else{
        outputDir = path.resolve(process.cwd(), '../output/cloneAndextractOnly_result/'+libName + '/' + '/all'+'/'+date);
    }

    let outputPath = 'file1';
    if(state && state.length > 0) {
        outputPath = output_json.getUniqueOutputPath(outputDir, 'history-'+state,client_list.length.toString());
    }else {
        outputPath = output_json.getUniqueOutputPath(outputDir, 'version_history',client_list.length.toString());
    }
    //const outputPath = output_json.getUniqueOutputPath(outputDir, 'version_history:',limit.toString());
    // JSONデータをファイルに書き込む
    console.log('outputPath：',outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(verHistory, null, 2));
    return verHistory;
};

function formatDateTimeForFilename(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0'); // 月は0から始まるため+1
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');

    return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}
