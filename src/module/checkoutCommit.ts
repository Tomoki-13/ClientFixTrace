import fs from "fs";
import path from "path";
import { execSync } from 'child_process';
import { Client_Ver, VersionCommits } from "../types/VersionCommits";
import { getVersion } from "./getVersion";

// クライアントのパスを入力し、バージョン遷移を出力
export const checkoutCommit = async (repoPath: string, libName: string): Promise<Client_Ver> => {
    // リポジトリが存在しない場合はエラー
    if (!fs.existsSync(repoPath)) {
        throw new Error(`no directory: ${repoPath}`);
    }
    if (!fs.existsSync(path.join(repoPath, ".git"))) {
        throw new Error(`no git repository: ${repoPath}`);
    }

     // 元のディレクトリを記憶
    const originalDir = process.cwd();
    process.chdir(repoPath);
    let verHistory: VersionCommits[] = [];
    const clientName = repoPath.split('/').slice(-2).join('/');
    if (process.cwd() === repoPath) {
        console.log('true');
    }
    
    // スクリプトの最後に必ず元の状態に戻すためのtry...finallyブロック
    try {
        const branchName = getDefaultBranch(repoPath);

        // デフォルトブランチの履歴に沿って、package.jsonが変更されたコミットを古い順に取得
        const command = `git rev-list --reverse ${branchName} -- package.json`;
        const package_commits = execSync(command).toString().split('\n').filter(Boolean);
        console.log(`package.jsonのコミット数:`, package_commits.length);

        if (package_commits.length === 0) {
            console.warn("package.jsonのコミットが見つかりませんでした。");
            return { client: clientName, verList: [] };
        }

        for (const commit of package_commits) {
            try {
                // --- Gitチェックアウトエラーの防止 ---
                execSync(`git reset --hard HEAD`, { cwd: repoPath, stdio: 'ignore' });
                execSync(`git clean -fd`, { cwd: repoPath, stdio: 'ignore' });
                execSync(`git checkout -f ${commit}`, { cwd: repoPath, stdio: 'pipe' });
                // getVersion内でJSONパースエラーが発生しても、ここでキャッチして処理を続行
                const verNum: string = getVersion(repoPath, libName);

                // 有効なバージョンが取得できた場合のみ履歴に追加
                if (verNum.length > 0 && verNum !== 'no') {
                    // 履歴が空、または直前のバージョンと異なる場合のみ追加
                    if (verHistory.length === 0 || verHistory.at(-1)?.version !== verNum) {
                        verHistory.push({ version: verNum, commit: commit });
                    }
                }
            } catch (error) {
                // チェックアウトやバージョン取得中にエラーが発生した場合はログに出力してスキップ
                console.error(`コミット ${commit} の処理中にエラーが発生しました。スキップします。`, error instanceof Error ? error.message : error);
                continue;
            }
        }

    } finally {
        // --- スクリプトの最後に必ず元の状態に戻す ---
        try {
            const branchName = getDefaultBranch(repoPath);
            execSync(`git reset --hard HEAD`, { cwd: repoPath, stdio: 'ignore' });
            execSync(`git clean -fd`, { cwd: repoPath, stdio: 'ignore' });
            execSync(`git checkout -f ${branchName}`, { cwd: repoPath, stdio: 'pipe' });
        } catch (err) {
            console.error(`元のブランチに戻る処理に失敗しました。`, err);
        }
        process.chdir(originalDir);
    }
    return { client: clientName, verList: verHistory };
}
const getDefaultBranch = (repoPath: string): string => {
    try {
        execSync('git rev-parse --verify main', { cwd: repoPath, stdio: 'ignore' });
        return 'main';
    } catch {
        try {
            execSync('git rev-parse --verify master', { cwd: repoPath, stdio: 'ignore' });
            return 'master';
        } catch {
            try {
                const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', { cwd: repoPath }).toString().trim();
                return ref.replace('refs/remotes/origin/', '');
            } catch {
                throw new Error(`[${repoPath}] main でも master でもブランチが見つかりませんでした`);
            }
        }
    }
};