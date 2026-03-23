/**
 * バージョン文字列のパース・比較・ソート
 */

// 文字列から数値配列へクリーンアップ
function clean(ver: string): number[] {
  if (!ver || typeof ver !== 'string') return [0, 0, 0];
  return ver.trim().replace(/^[\^~><= ]+/, '').split('-')[0].split('.').map(num => parseInt(num, 10));
}

// 2つのバージョンを比較
function compare(a: string, b: string): number[] {
  const aNum = clean(a);
  const bNum = clean(b);
  const maxLength = Math.max(aNum.length, bNum.length);
  let result: number[] = [];
  for (let i = 0; i < maxLength; i++) {
    result[i] = (aNum[i] || 0) - (bNum[i] || 0);
  }
  return result;
}

// SemVerベースのソートロジック (pre-release対応)
function sort(versions: string[]): string[] {
  return [...new Set(versions)].sort((a, b) => {
    const parseVer = (v: string) => {
      const dashIdx = v.indexOf('-');
      const main = dashIdx > -1 ? v.slice(0, dashIdx) : v;
      const pre = dashIdx > -1 ? v.slice(dashIdx + 1) : '';
      return { parts: main.split('.').map(Number), pre };
    };

    const vA = parseVer(a);
    const vB = parseVer(b);

    for (let i = 0; i < Math.max(vA.parts.length, vB.parts.length); i++) {
      const numA = vA.parts[i] || 0;
      const numB = vB.parts[i] || 0;
      if (numA !== numB) return numA - numB;
    }

    if (vA.pre && !vB.pre) return -1;
    if (!vA.pre && vB.pre) return 1;
    if (vA.pre && vB.pre) return vA.pre.localeCompare(vB.pre, undefined, { numeric: true, sensitivity: 'base' });
    return 0;
  });
}

// 更新かダウングレードかの判定
function judgeUpOrDown(verPair: string[]): 'update' | 'downgrade' | 'same' {
  const res = compare(verPair[0], verPair[1]);
  for (const diff of res) {
    if (diff > 0) return 'downgrade';
    if (diff < 0) return 'update';
  }
  return 'same';
}

// ver が base 以上であるか
function isGreaterOrEqual(ver: string, base: string): boolean {
  const res = compare(ver, base);
  for (const diff of res) {
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return true;
}

export default { 
  clean,
  compare,
  sort,
  judgeUpOrDown,
  isGreaterOrEqual
};