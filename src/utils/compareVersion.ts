//バージョンを昇順に比較
export const compareVersions = (a: string, b: string): number[] => {
  const a_num = cleanVersion(a);
  const b_num = cleanVersion(b);
  const maxLength = Math.max(a_num.length, b_num.length);
  let result: number[] = [];

  for (let i = 0; i < maxLength; i++) {
    const numA = a_num[i] || 0;
    const numB = b_num[i] || 0;
    result[i] = numA - numB;
  }
  return result;
}

export function cleanVersion(ver: string): number[] {
  if (!ver || typeof ver !== 'string') return [0, 0, 0];
  const result = ver.trim().replace(/^[\^~><= ]+/, '').split('-')[0].split('.').map(num => parseInt(num, 10));
  return result;
};

//バージョン更新がupdate, downgrade, sameの判定
export const judge_up_or_down = (ver_pair: string[]): 'update' | 'downgrade' | 'same' => {
  if (ver_pair.length !== 2) {
    throw new Error('Invalid version pair');
  } else {
    //pre:更新前バージョン，post:更新後バージョン
    const pre_verNum: number[] = cleanVersion(ver_pair[0]);
    const post_verNum: number[] = cleanVersion(ver_pair[1]);
    const maxLength = Math.max(pre_verNum.length, post_verNum.length);

    for (let i = 0; i < maxLength; i++) {
      const preNum = pre_verNum[i] || 0;
      const postNum = post_verNum[i] || 0;
      if (preNum > postNum) return 'downgrade';
      if (preNum < postNum) return 'update';
    }
    //どの数字にも差がない場合は同じバージョン
    return 'same';
  }
};