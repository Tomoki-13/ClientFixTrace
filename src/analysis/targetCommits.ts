import { Client_Ver, specificCommit } from "../types/VersionCommits";
import versionUtil from "./versionUtil";

/**
 * 履歴データ(Client_Ver配列)から、特定のターゲットバージョン(targetVersion)以上に
 * アップデートされた際のコミット情報（更新前後のバージョンやコミットID等）を抽出します。
 * * @param data - クライアントのバージョン履歴データの配列
 * @param libName - ターゲットとなるライブラリ名
 * @param targetVersion - 基準となるアップデート後のバージョン（例: "3.0.5"）
 * @returns ターゲットバージョン以上に更新された際の具体的なコミット情報(specificCommit)の配列
 */
function get(data: Client_Ver[], libName: string, targetVersion: string): specificCommit[] {
  let result: specificCommit[] = [];

  for (const clientData of data) {
    const raw = clientData as any;

    // verList の中から、ターゲットバージョン以上になった最初の時点（インデックス）を探す
    const index = raw.verList.findIndex((v: any) => {
      const versions = versionUtil.normalize(v.L_libVersion || v.libVersion).split(' || ');
      const maxVer = versions[versions.length - 1];

      // 最大バージョンがターゲットバージョン以上かどうかを判定
      return versionUtil.isGreaterOrEqual(maxVer, targetVersion);
    });

    // ターゲットバージョン以上にアップデートされた履歴が見つかった場合
    if (index !== -1) {
      const post = raw.verList[index];
      const pre = index > 0 ? raw.verList[index - 1] : null;

      result.push({
        C_client: raw.C_client || raw.client,
        L_libName: libName,
        L_targetVersion: targetVersion,
        L_preLibVersion: pre ? (pre.L_libVersion || pre.libVersion) : "unknown",
        L_postLibVersion: post.L_libVersion || post.libVersion,
        C_commitID: post.C_commitID || post.commitID,
        C_tagCommitID: post.C_tagCommitID || post.tagCommitID
      });
    }
  }
  return result;
}

export default { get };