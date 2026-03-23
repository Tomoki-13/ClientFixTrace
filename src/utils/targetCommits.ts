import { Client_Ver, specificCommit } from "../types/VersionCommits";
import versionUtil from "./versionUtil";

/**
 * 履歴データから特定のバージョンに対応するコミットペア（更新前・後）を抽出する
 * 使われていないように見えますが、全履歴(Master)から特定のペア(Task)を切り出す際に必須です。
 */
function get(data: Client_Ver[], libName: string, targetVersion: string): specificCommit[] {
  let result: specificCommit[] = [];
  for (const clientData of data) {
    const index = clientData.verList.findIndex((v) =>
      versionUtil.isGreaterOrEqual(v.L_libVersion, targetVersion)
    );

    if (index !== -1) {
      const post = clientData.verList[index];
      const pre = index > 0 ? clientData.verList[index - 1] : null;

      result.push({
        C_client: clientData.C_client,
        L_libName: libName,
        L_targetVersion: targetVersion,
        L_preLibVersion: pre ? pre.L_libVersion : "unknown/initial",
        L_postLibVersion: post.L_libVersion,
        C_commitID: post.C_commitID,
        C_tagCommitID: post.C_tagCommitID
      });
    }
  }
  return result;
}

export default { get };