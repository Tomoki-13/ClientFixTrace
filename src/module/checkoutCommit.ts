import fs from "fs";
import { execSync } from 'child_process';
import { Client_Ver, VersionCommits } from "../types/VersionCommits";
import { getVersion } from "./getVersion";

//クライアントのパスを入力し，バージョン遷移を出力
export const checkoutCommit = async (repoPath: string, libName: string): Promise<Client_Ver> => {
    let verHistory:VersionCommits[] = [];

    //リポジトリが存在するか確認
    if(!fs.existsSync(repoPath)) {
        throw new Error("指定されたリポジトリディレクトリが存在しません");
    }

    //リポジトリのディレクトリに移動
    process.chdir(repoPath);
    const branchName = getDefaultBranch();
    //古い→新しい順にコミットを取得
    //マージコミットに実際に含まれる変更のみ対象
    // const package_commits = execSync('git log --merges --reverse --pretty=format:"%H" -- package.json').toString().split('\n').filter(Boolean);
    // console.log(`package.jsonのコミット数:`, package_commits.length);
    //マージされていないコミットも対象
    const package_json = execSync('git rev-list --reverse HEAD --all -- package.json').toString().split('\n').filter(Boolean);
    console.log(`package.jsonのコミット数:`, package_json.length);
    //マージされたものに選別
    const package_commits = package_json.filter(commit => {
        try {
          // `HEAD` に含まれていれば、少なくとも1つのマージで取り込まれたとみなす
          const branches = execSync(`git branch --contains ${commit}`).toString();
          return branches.includes('*') || branches.includes('main') || branches.includes('master');
        } catch {
          return false;
        }
    });
    console.log(`package_commitsのコミット数:`, package_commits.length);
    let num = 0;
    for(const [index, commit] of package_commits.entries()) {
        // console.log(`コミット${index + 1}: ${commit}`);
        //コミットが存在するか確認
        try{
            const type = execSync(`git cat-file -t ${commit}`).toString().trim();
            if (type !== 'commit') {
                //console.log(`無効なコミット: ${commit}（タイプ: ${type}） スキップします`);
                continue;
            }
        } catch (err) {
            //console.log(`コミット ${commit} は存在しません。スキップ`);
            continue;
        }

        try{
            //作業ツリーを強制的にリセットしてから checkout
            execSync(`git reset --hard`, { stdio: 'ignore' });
            execSync(`git clean -fd`, { stdio: 'ignore' });
            execSync(`git checkout ${commit}`, { stdio: 'pipe' });

            //ライブラリを調査
            let verNum:string = getVersion(repoPath, libName);
            if(verNum.length > 0 && verNum !== 'no') {
                // 同じバージョンでなければ追加
                if(verHistory.length === 0 || verHistory.at(-1)?.version != verNum || verNum == 'no lib') {
                    verHistory.push({ version: verNum, commit: commit });
                }
            }
            num++;
        } catch (error) {
            console.error(`コミット ${commit} に切り替え中にエラーが発生しました:`, error);
            continue;
        }
    };
    //初期状態への回帰
    try{
        execSync(`git checkout ${branchName}`, { stdio: 'inherit' });
        //console.log(`${branchName} ブランチに戻りました`);
    } catch (err) {
        //console.error(`${branchName} ブランチに戻るのに失敗しました`, err);
    }

    //出力の整形
    let c_ver:Client_Ver = {client:repoPath.split('/').slice(-2).join('/'),verList:verHistory} 
    return c_ver;
}

const getDefaultBranch = (): string => {
    try {
        execSync('git rev-parse --verify main', { stdio: 'ignore' });
        return 'main';
    } catch {
        try {
            execSync('git rev-parse --verify master', { stdio: 'ignore' });
            return 'master';
        } catch {
            try {
                const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD').toString().trim();
                return ref.replace('refs/remotes/origin/', '');
            } catch {
                throw new Error('main でも master でもブランチが見つかりませんでした');
            }
        }
    }
};