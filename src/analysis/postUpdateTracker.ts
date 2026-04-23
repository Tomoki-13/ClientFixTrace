// analysis/postUpdateTracker.ts

// バージョンの大小を比較する補助関数
export function compareVer(v1: string, v2: string): 'greater' | 'less' | 'equal' | 'invalid' {
  if (!v1 || !v2 || v1 === "not_found" || v2 === "not_found" || v1 === "unknown" || v2 === "unknown") return 'invalid';
  const c1 = v1.replace(/^[^\d]+/, '').split('-')[0].split('.').map(Number);
  const c2 = v2.replace(/^[^\d]+/, '').split('-')[0].split('.').map(Number);

  for (let i = 0; i < Math.max(c1.length, c2.length); i++) {
    const num1 = c1[i] || 0;
    const num2 = c2[i] || 0;
    if (num1 > num2) return 'greater';
    if (num1 < num2) return 'less';
  }
  return 'equal';
}

// 抽出されたターゲット群に対して、アップデート後の3リリースの軌跡を判定して返す
export function trackPostUpdate(targets: any[], verHistory: any[], postVersion: string) {
  return targets.map(target => {
    const clientData = verHistory.find((v: any) => v.C_client === target.C_client);
    const commitData = clientData?.verList?.find((v: any) => v.C_commitID === target.C_commitID);

    const releases = commitData?.C_releases || [];
    const trackingResult: any = {
      client: target.C_client,
      targetCommitID: target.C_commitID,
      updatedTo: postVersion,
      finalStatus: "no_release",
      releases: []
    };

    let hasDowngrade = false;
    let hasFurtherUpdate = false;

    for (let i = 0; i < 3; i++) {
      const rel = releases[i];
      if (!rel || !rel.C_tagCommitID || rel.C_tagCommitID === 'no-subsequent-release') {
        trackingResult.releases.push("NO_RELEASE_FOUND");
        continue;
      }

      const relLibVer = rel.L_libVersion;
      const comp = compareVer(relLibVer, postVersion);

      let statusStr = "";
      if (comp === 'less') {
        statusStr = `${relLibVer} (Downgraded)`;
        hasDowngrade = true;
      } else if (comp === 'greater') {
        statusStr = `${relLibVer} (Upgraded Further)`;
        hasFurtherUpdate = true;
      } else if (comp === 'equal') {
        statusStr = `${relLibVer} (Maintained)`;
      } else {
        statusStr = `${relLibVer} (Unknown)`;
      }

      trackingResult.releases.push({
        releaseTag: rel.C_releaseVersion,
        commitID: rel.C_tagCommitID,
        libVersionAtRelease: statusStr
      });
    }

    if (hasDowngrade) {
      trackingResult.finalStatus = "downgraded_eventually";
    } else if (hasFurtherUpdate) {
      trackingResult.finalStatus = "upgraded_eventually";
    } else if (releases.length > 0 && trackingResult.releases[0] !== "NO_RELEASE_FOUND") {
      trackingResult.finalStatus = "maintained";
    }

    return trackingResult;
  });
}