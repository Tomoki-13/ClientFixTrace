import fs from "fs";
import { execSync } from 'child_process';
import { VersionCommits } from "../types/VersionCommits";
import { getVersion } from "./getVersion";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const checkoutCommit = async (repoPath: string, libName: string): Promise<VersionCommits[]> => {
    let verHistory:VersionCommits[] = [];
    //リポジトリが存在するか確認
    if(!fs.existsSync(repoPath)) {
        throw new Error("指定されたリポジトリディレクトリが存在しません");
    }
    let branchName = await getDefaultBranch();
    console.log(`デフォルトブランチ: ${branchName}`);
    //リポジトリのディレクトリに移動
    process.chdir(repoPath);
    //最新--古の順でないとコミット切り替えでバグ
    // const package_commits = execSync('git log  --pretty=format:%H -- package.json').toString().split('\n');
    const package_commits = execSync('git rev-list HEAD --all -- package.json').toString().split('\n');
    console.log(`package.jsonのコミット数:`, package_commits);
    console.log(`package.jsonのコミット数:`, package_commits.length);
    
    //コミット履歴を取得 commits[0]がfirst commit
    // const commits = execSync('git log --reverse --pretty=format:"%H"').toString().split('\n');
    // console.log(`コミット数:`, commits.length);
    let num = 0;
    for(const [index, commit] of package_commits.entries()) {
        console.log(`コミット${index + 1}: ${commit}`);
        //コミットが存在するか確認
        try{
            const type = execSync(`git cat-file -t ${commit}`).toString().trim();
            if (type !== 'commit') {
                console.warn(`無効なコミット: ${commit}（タイプ: ${type}） スキップします`);
                continue;
            }
        } catch (err) {
            console.warn(`コミット ${commit} は存在しません。スキップ`);
            continue;
        }

        try{
            //作業ツリーを強制的にリセットしてから checkout
             execSync(`git reset --hard`, { stdio: 'ignore' });
             execSync(`git clean -fd`, { stdio: 'ignore' });
            //git checkout でそのコミットに切り替え
            execSync(`git checkout ${commit}`, { stdio: 'pipe' });
            //ライブラリを調査
            let verNum:string = getVersion(repoPath, libName);
            if(verNum.length > 0) {
                // 同じバージョンでなければ追加
                if(verHistory.length === 0 || verHistory.at(-1)?.version != verNum || verNum == 'no lib') {
                    verHistory.push({ version: verNum, commit: commit });
                }
                // console.log(`コミット ${commit} のバージョン: ${verNum}`);
            }
            num++;
            await sleep(2000);

        } catch (error) {
            console.error(`コミット ${commit} に切り替え中にエラーが発生しました:`, error);
            continue;
        }
    };

    console.log(`切り替え数:`, num);
    console.log(`バージョンリスト:`, verHistory);
    //初期状態への回帰
    try{
        execSync(`git checkout ${branchName}`, { stdio: 'inherit' });
        console.log(`${branchName} ブランチに戻りました`);
    } catch (err) {
        console.error(`${branchName} ブランチに戻るのに失敗しました`, err);
    }
    await sleep(2000);
    
    return verHistory;
}

const getDefaultBranch = async (): Promise<string> => {
    //最新状態に戻す
    let defaultBranch = 'main';
    try{
        // mainブランチが存在するか確認
        if(execSync('git rev-parse --verify main', { stdio: 'ignore' }) !== null) {
            defaultBranch = 'main';
        }else{
            defaultBranch = 'master';
        }
    
    } catch {
        try{
            //なければ master を試す
            execSync('git rev-parse --verify master', { stdio: 'ignore' });
            defaultBranch = 'master';
        } catch {
            throw new Error('main でも master でもブランチが見つかりませんでした');
        }
    }
    return defaultBranch;
}