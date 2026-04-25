import { execSync } from "child_process";
import { ReleaseHistory } from "../types/VersionCommits";

/**
 * [入出力説明]
 * 入力:
 * - repoPath (string): ローカルリポジトリの絶対パス
 * - libName (string): 検索対象のライブラリ名
 * - updateCommitID (string): ライブラリを更新したコミットID
 * 出力:
 * - ReleaseHistory[]: コミット以降の最大3件のリリース情報（タグ、クライアントバージョン、ライブラリバージョン）の配列。失敗時は空配列。
 */
export function getReleaseHistory(repoPath: string, libName: string, updateCommitID: string): ReleaseHistory[] {
  const history: ReleaseHistory[] = [];
  try {
    const tagsRaw = execSync(
      `git -C "${repoPath}" tag --contains ${updateCommitID} --sort=creatordate`,
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: "utf-8" }
    ).toString().trim();

    if (!tagsRaw) return [];

    const tags = tagsRaw.split("\n").slice(0, 3);

    for (const tag of tags) {
      const tagCommitID = execSync(`git -C "${repoPath}" rev-parse ${tag}`, { encoding: "utf-8" }).toString().trim();
      const pkgRaw = execSync(`git -C "${repoPath}" show ${tag}:package.json`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();

      const pkg = JSON.parse(pkgRaw) as Record<string, any>;

      history.push({
        C_tagCommitID: tagCommitID,
        C_releaseVersion: pkg.version || "unknown",
        L_libVersion: pkg.dependencies?.[libName] || pkg.devDependencies?.[libName] || "not_found"
      });
    }
  } catch (error) {
    // パース失敗時は握りつぶして空配列を返す
  }
  return history;
}