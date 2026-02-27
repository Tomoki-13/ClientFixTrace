import fs from "fs";
import path from 'path';
import output_json from "../utils/output_json";
import { cloneRepo } from "../git/cloneRepo";
import { checkoutCommit } from "../git/checkoutCommit";
import { Client_Ver } from "../types/VersionCommits";

// リポジトリを順番にクローン
//libVersionはファイル名を変更するためだけに使用(client_listでフィルタリング済み)
export const extractVersion = async (client_list: string[], libName: string, libNum: string = '0', state: string = ''):
  Promise<Client_Ver[]> => {
  //process.cwd() == src
  let std_Dir: string = path.resolve(process.cwd(), '../clientRepos/');
  // 出力先ディレクトリの作成
  output_json.createOutputDirectory(std_Dir);
  // ライブラリ名のディレクトリを作成 clientRepos/libName
  let cloneDir = path.join(std_Dir, libName);
  output_json.createOutputDirectory(cloneDir);
  console.log(process.cwd());
  let verHistory: Client_Ver[] = [];

  //クライアントのリストを600に制限
  // let limit = 5;
  let count = 0;

  //ぞれぞれにクローン，チェックアウト，バージョン確認を実行
  for (const client of client_list) {
    // if(count >= limit) {
    //     console.log(`DEBUG:クライアントの取得を終了します。`);
    //     break;
    // }else{
    //     console.log(`クライアントの取得を続行します。残り${limit - count}件`);
    // }
    try {
      let repoPath = await cloneRepo(client, cloneDir);
      if (!repoPath) {
        console.warn(`clone failure: ${client}`);
        continue;
      }
      let c_data: Client_Ver = await checkoutCommit(repoPath, libName);
      //バージョン数が最低でも2以上のものを取得　変更しているものに限定
      if (c_data && c_data.verList.length > 1) {
        verHistory = verHistory.concat(c_data);
      }
      process.chdir(std_Dir);
      count++;
    } catch (error) {
      console.error(error);
      count++;
    }
  }
  return verHistory;
};
