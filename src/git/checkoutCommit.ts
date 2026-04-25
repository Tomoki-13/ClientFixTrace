import fs from "fs";
import path from "path";
import { execSync } from 'child_process';
import { Client_Ver, VersionCommits, ReleaseInfo, ReleaseHistory } from "../types/VersionCommits";

/**
 * [入出力説明]
 * 入力:
 * - repoPath (string): ローカルリポジトリの絶対パス
 * - libName (string): 検索対象のライブラリ名
 * 出力:
 * - Promise<Client_Ver>: クライアント名と、依存ライブラリ更新履歴のリストを含むオブジェクト
 */
export const checkoutCommit = async (repoPath: string, libName: string): Promise<Client_Ver> => {
  if (!fs.existsSync(repoPath) || !fs.existsSync(path.join(repoPath, ".git"))) {
    return { C_client: repoPath.split('/').slice(-2).join('/'), verList: [] };
  }

  const originalDir = process.cwd();
  process.chdir(repoPath);
  const clientName = repoPath.split('/').slice(-2).join('/');

  try {
    const branchName = getDefaultBranch(repoPath);

    execSync(`git reset --hard HEAD`, { stdio: 'ignore' });
    execSync(`git clean -fd`, { stdio: 'ignore' });
    execSync(`git checkout -f ${branchName}`, { stdio: 'ignore' });

    const logs = execSync(`git log --reverse --pretty=format:"%H %cI" ${branchName} -- package.json`)
      .toString().split('\n').filter(Boolean);

    const list1_libUpdates: { version: string, commitID: string, timestamp: string }[] = [];
    const list2_clientReleases: ReleaseInfo[] = [];

    let lastLibVer = "";
    let lastClientVer = "";

    for (const logLine of logs) {
      const [hash, timestamp] = logLine.split(' ');
      try {
        const content = execSync(`git show ${hash}:package.json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        
        // 型エラー修正箇所: Record<string, any> にキャスト
        const pkg = JSON.parse(content) as Record<string, any>;

        const currentLibVer = pkg.dependencies?.[libName] || pkg.devDependencies?.[libName];
        const currentClientVer = pkg.version;

        if (currentLibVer && currentLibVer !== lastLibVer) {
          list1_libUpdates.push({ version: currentLibVer, commitID: hash, timestamp });
          lastLibVer = currentLibVer;
        }

        if (currentClientVer && currentClientVer !== lastClientVer) {
          list2_clientReleases.push({
            C_version: currentClientVer,
            C_preVersion: lastClientVer || "none",
            C_commitID: hash,
            timestamp
          });
          lastClientVer = currentClientVer;
        }
      } catch (err) {
        continue;
      }
    }

    const matchedHistory: VersionCommits[] = list1_libUpdates.map(libUpdate => {
      const nearestRelease = list2_clientReleases.find(rel =>
        new Date(rel.timestamp) > new Date(libUpdate.timestamp)
      );

      return {
        L_libVersion: libUpdate.version,
        C_commitID: libUpdate.commitID,
        C_tagCommitID: nearestRelease ? nearestRelease.C_commitID : "no-subsequent-release",
        C_releaseVersion: nearestRelease ? nearestRelease.C_version : "none",
        C_preReleaseVersion: nearestRelease ? nearestRelease.C_preVersion : "none"
      };
    });

    return { C_client: clientName, verList: matchedHistory };

  } finally {
    try {
      const branchName = getDefaultBranch(repoPath);
      execSync(`git reset --hard HEAD`, { stdio: 'ignore' });
      execSync(`git checkout -f ${branchName}`, { stdio: 'ignore' });
    } catch (e) { }
    process.chdir(originalDir);
  }
};

/**
 * [入出力説明]
 * 入力:
 * - repoPath (string): ローカルリポジトリの絶対パス
 * 出力:
 * - string: 対象リポジトリのデフォルトブランチ名（main または master）
 */
const getDefaultBranch = (repoPath: string): string => {
  try {
    return execSync('git symbolic-ref --short refs/remotes/origin/HEAD', { cwd: repoPath })
      .toString().trim().replace('origin/', '');
  } catch {
    const branches = execSync('git branch -r', { cwd: repoPath }).toString();
    if (branches.includes('origin/main')) return 'main';
    return 'master';
  }
};