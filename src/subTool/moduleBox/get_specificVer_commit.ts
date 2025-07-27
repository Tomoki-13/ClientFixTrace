import { Client_Ver,specificCommit } from '../../types/VersionCommits';
/**
 * 特定のバージョンより大きいバージョンを持つクライアントのコミット情報を取得
 * 
 * @param {Client_Ver[]} data - クライアントとそのバージョン履歴の配列
 * @param {string} targetVersion - 基準となるバージョン
 * @returns {specificCommit[]} targetVersionを超えるバージョンのコミット情報
 */
export function get_specificVer_commit(data: Client_Ver[], targetVersion: string): specificCommit[] {
    let result: specificCommit[] = [];
    const semverGt = (a: string, b: string): boolean => {
        const normalize = (v: string) => v.replace(/^[^\d]*/, "");
        const [aMajor, aMinor, aPatch] = normalize(a).split(".").map(Number);
        const [bMajor, bMinor, bPatch] = normalize(b).split(".").map(Number);
        if (aMajor !== bMajor) return aMajor > bMajor;
        if (aMinor !== bMinor) return aMinor > bMinor;
        return aPatch > bPatch;
    };

    for (const clientData of data) {
        for (const item of clientData.verList) {
            if (semverGt(item.version, targetVersion)) {
                result.push({
                    client: clientData.client,
                    version: item.version,
                    commit: item.commit
                });
                break;
            }
        }
    }
    return result;
}