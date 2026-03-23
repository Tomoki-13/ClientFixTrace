import { Client_Ver, specificCommit } from "../types/VersionCommits";
import getMatchedClients from './getMatchedClients';

/**
 * 履歴データから特定のバージョンに対応するコミットペア（更新前・後）を抽出する
 */
function get(data: Client_Ver[], libName: string, targetVersion: string): specificCommit[] {
  let result: specificCommit[] = [];
  for (const clientData of data) {
    // ターゲットバージョン以上の最初のインデックスを特定
    const index = clientData.verList.findIndex((v) =>
      getMatchedClients.isVersionGreaterOrEqual(v.L_libVersion, targetVersion)
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