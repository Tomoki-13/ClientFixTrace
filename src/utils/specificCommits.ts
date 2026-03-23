import { Client_Ver, specificCommit } from '../types/VersionCommits';
import GetMatchedClients from './getMatchedClients';

/**
 * 特定のバージョン以上のバージョンを持つクライアントのコミット情報を取得
 * 更新前後のバージョン情報やターゲット情報を含める
 * * @param {Client_Ver[]} data - クライアントとそのバージョン履歴の配列
 * @param {string} libName - 検索対象のライブラリ名
 * @param {string} targetVersion - 基準となるターゲットバージョン
 * @returns {specificCommit[]} 拡張されたコミット情報のリスト
 */
function get(
  data: Client_Ver[],
  libName: string,
  targetVersion: string
): specificCommit[] {
  let result: specificCommit[] = [];

  for (const clientData of data) {
    // verListの中から、ターゲットバージョン以上の最初のインデックスを特定
    const index = clientData.verList.findIndex(v =>
      GetMatchedClients.isVersionGreaterOrEqual(v.L_libVersion, targetVersion)
    );

    if (index !== -1) {
      const postEntry = clientData.verList[index];
      // 更新前のエントリ（一つ前のインデックス）を取得
      const preEntry = index > 0 ? clientData.verList[index - 1] : null;

      result.push({
        C_client: clientData.C_client,
        L_libName: libName,
        L_targetVersion: targetVersion,
        L_preLibVersion: preEntry ? preEntry.L_libVersion : "unknown/initial",
        L_postLibVersion: postEntry.L_libVersion,
        C_commitID: postEntry.C_commitID,
        C_tagCommitID: postEntry.C_tagCommitID
      });
    }
  }
  return result;
}

export default { get };