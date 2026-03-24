import { Client_Ver, specificCommit } from "../types/VersionCommits";
import versionUtil from "./versionUtil";

function get(data: Client_Ver[], libName: string, targetVersion: string): specificCommit[] {
  let result: specificCommit[] = [];
  for (const clientData of data) {
    const raw = clientData as any;
    const index = raw.verList.findIndex((v: any) => {
      // || が含まれる場合、分割して最大のバージョンをターゲットと比較する
      const versions = versionUtil.normalize(v.L_libVersion || v.libVersion).split(' || ');
      const maxVer = versions[versions.length - 1];
      return versionUtil.isGreaterOrEqual(maxVer, targetVersion);
    });

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