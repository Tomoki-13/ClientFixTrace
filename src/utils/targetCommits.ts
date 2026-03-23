import { Client_Ver, specificCommit } from "../types/VersionCommits";
import GetMatchedClients from './getMatchedClients';

function get(data: Client_Ver[], libName: string, targetVersion: string): specificCommit[] {
  let result: specificCommit[] = [];
  for (const clientData of data) {
    const raw = clientData as any;
    const index = raw.verList.findIndex((v: any) =>
      GetMatchedClients.isVersionGreaterOrEqual(v.L_libVersion || v.libVersion, targetVersion)
    );
    if (index !== -1) {
      const post = raw.verList[index];
      const pre = index > 0 ? raw.verList[index - 1] : null;
      result.push({
        C_client: raw.C_client || raw.client,
        L_libName: libName,
        L_targetVersion: targetVersion,
        L_preLibVersion: pre ? (pre.L_libVersion || pre.libVersion) : "unknown/initial",
        L_postLibVersion: post.L_libVersion || post.libVersion,
        C_commitID: post.C_commitID || post.commitID,
        C_tagCommitID: post.C_tagCommitID || post.tagCommitID
      });
    }
  }
  return result;
}

export default { get };