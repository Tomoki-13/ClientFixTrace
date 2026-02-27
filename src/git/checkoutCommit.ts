import fs from "fs";
import path from "path";
import { execSync } from 'child_process';
import { Client_Ver, VersionCommits, ReleaseInfo } from "../types/VersionCommits";

export const checkoutCommit = async (repoPath: string, libName: string): Promise<Client_Ver> => {
  if (!fs.existsSync(repoPath) || !fs.existsSync(path.join(repoPath, ".git"))) {
    console.warn(`[Skip] Invalid repository: ${repoPath}`);
    return { client: repoPath.split('/').slice(-2).join('/'), verList: [] };
  }

  const originalDir = process.cwd();
  process.chdir(repoPath);
  const clientName = repoPath.split('/').slice(-2).join('/');

  try {
    const branchName = getDefaultBranch(repoPath);

    // 実行環境のクリーンアップ（過去の実行の影響を排除）
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
        const pkg = JSON.parse(content);

        const currentLibVer = pkg.dependencies?.[libName] || pkg.devDependencies?.[libName];
        const currentClientVer = pkg.version;

        // 依存ライブラリの更新を抽出
        if (currentLibVer && currentLibVer !== lastLibVer) {
          list1_libUpdates.push({ version: currentLibVer, commitID: hash, timestamp });
          lastLibVer = currentLibVer;
        }

        // クライアント自身のリリース（バージョン更新）を抽出
        if (currentClientVer && currentClientVer !== lastClientVer) {
          list2_clientReleases.push({
            version: currentClientVer,
            preVersion: lastClientVer || "none", // 更新前のバージョンを記録
            commitID: hash,
            timestamp
          });
          lastClientVer = currentClientVer;
        }
      } catch (err) {
        // 不正なJSON形式のコミットはスキップ
        continue;
      }
    }

    // ライブラリ更新に対し、その直後のリリースのバージョン情報を紐付け
    const matchedHistory: VersionCommits[] = list1_libUpdates.map(libUpdate => {
      const nearestRelease = list2_clientReleases.find(rel =>
        new Date(rel.timestamp) > new Date(libUpdate.timestamp)
      );
      return {
        libVersion: libUpdate.version,
        commitID: libUpdate.commitID,
        tagCommitID: nearestRelease ? nearestRelease.commitID : "no-subsequent-release",
        releaseVersion: nearestRelease ? nearestRelease.version : "none",
        preReleaseVersion: nearestRelease ? nearestRelease.preVersion : "none"
      };
    });

    return { client: clientName, verList: matchedHistory };

  } finally {
    // リポジトリを作業開始前の最新状態に完全復元
    try {
      const branchName = getDefaultBranch(repoPath);
      execSync(`git reset --hard HEAD`, { stdio: 'ignore' });
      execSync(`git checkout -f ${branchName}`, { stdio: 'ignore' });
    } catch (e) { }
    process.chdir(originalDir);
  }
};

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