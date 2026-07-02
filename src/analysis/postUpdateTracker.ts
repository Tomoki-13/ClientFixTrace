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

      // postVersion = 破壊的更新で採用した版
      // 後続リリース時点の使用版 relLibVer と比較し、クライアントのその後の振る舞いを判定
      //   relLibVer <  post … 古い版へ戻した        → Downgraded（更新の取り下げ）
      //   relLibVer >  post … さらに新しい版へ進んだ → Upgraded Further（更新の継続）
      //   relLibVer == post … 採用した版のまま       → Maintained（更新の定着）
      const relLibVer = rel.L_libVersion;
      const comp = compareVer(relLibVer, postVersion);

      let statusStr = "";
      if (comp === 'less') {            // 古い版に戻した
        statusStr = `${relLibVer} (Downgraded)`;
        hasDowngrade = true;
      } else if (comp === 'greater') {  // さらに新しい版へ
        statusStr = `${relLibVer} (Upgraded Further)`;
        hasFurtherUpdate = true;
      } else if (comp === 'equal') {    // 採用した版のまま維持
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

    // 後続3リリース全体での最終評価（ダウングレード優先 → 更なる更新 → 維持 → リリース無し）
    if (hasDowngrade) {
      trackingResult.finalStatus = "downgraded_eventually"; // 1回でも戻した
    } else if (hasFurtherUpdate) {
      trackingResult.finalStatus = "upgraded_eventually";   // 戻さず、さらに上げた
    } else if (releases.length > 0 && trackingResult.releases[0] !== "NO_RELEASE_FOUND") {
      trackingResult.finalStatus = "maintained";            // 採用版を維持し続けた
    }

    return trackingResult;
  });
}