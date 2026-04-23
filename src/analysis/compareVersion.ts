// バージョンを昇順に比較
function compare(a: string, b: string): number[] {
  const a_num = clean(a);
  const b_num = clean(b);
  const maxLength = Math.max(a_num.length, b_num.length);
  let result: number[] = [];

  for (let i = 0; i < maxLength; i++) {
    const numA = a_num[i] || 0;
    const numB = b_num[i] || 0;
    result[i] = numA - numB;
  }
  return result;
}

function clean(ver: string): number[] {
  if (!ver || typeof ver !== 'string') return [0, 0, 0];
  const result = ver.trim()
    .replace(/^[\^~><= ]+/, '')
    .split('-')[0]
    .split('.')
    .map(num => {
      const parsed = parseInt(num, 10);
      // NaN（*, latest 等）が発生した場合は 0 に変換してソートの崩壊を防ぐ
      return isNaN(parsed) ? 0 : parsed;
    });

  // 比較エラーを防ぐため、常に最低3桁 [major, minor, patch] は確保する
  while (result.length < 3) result.push(0);

  return result;
}

// バージョン更新がupdate, downgrade, sameの判定
function judgeUpOrDown(ver_pair: string[]): 'update' | 'downgrade' | 'same' {
  if (!ver_pair || ver_pair.length !== 2) {
    return 'same';
  } else {
    // pre:更新前バージョン，post:更新後バージョン
    const pre_verNum: number[] = clean(ver_pair[0]);
    const post_verNum: number[] = clean(ver_pair[1]);
    const maxLength = Math.max(pre_verNum.length, post_verNum.length);

    for (let i = 0; i < maxLength; i++) {
      const preNum = pre_verNum[i] || 0;
      const postNum = post_verNum[i] || 0;
      if (preNum > postNum) return 'downgrade';
      if (preNum < postNum) return 'update';
    }
    // どの数字にも差がない場合は同じバージョン
    return 'same';
  }
}

export default {
  compare,
  clean,
  judgeUpOrDown
};