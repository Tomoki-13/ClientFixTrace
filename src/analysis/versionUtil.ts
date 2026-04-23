/**
 * バージョン文字列の操作に関する共通ユーティリティ
 */

// 文字列から数値配列へクリーンアップ
function clean(ver: string): number[] {
  if (!ver || typeof ver !== 'string') return [0, 0, 0];
  const base = ver.trim().replace(/^[\^~><= ]+/, '').split('-')[0];
  return base.split('.').map(num => {
    const parsed = parseInt(num, 10);
    return isNaN(parsed) ? 0 : parsed; // 'x' や '*' は 0 に変換
  });
}

// 単純な1対1のバージョン比較
function compareSimple(a: string, b: string): number[] {
  const aNum = clean(a);
  const bNum = clean(b);
  const maxLength = Math.max(aNum.length, bNum.length);
  let result: number[] = [];
  for (let i = 0; i < maxLength; i++) {
    result[i] = (aNum[i] || 0) - (bNum[i] || 0);
  }
  return result;
}

// 新機能：バージョンの「正規化」（例: "^8.2.0 || ^9.0" -> "8.2.0 || 9.0.0"）
function normalize(ver: string): string {
  if (!ver || ver === "not_found" || ver === "none") return "0.0.0";
  
  const cleanVer = ver.trim().replace(/^[\\^~><= ]+/, '').split('-')[0];
  const parts = cleanVer.split('.');
  
  // 必ず3桁揃える
  const major = parts[0] || "0";
  const minor = parts[1] || "0";
  const patch = parts[2] || "0";
  
  return `${major}.${minor}.${patch}`;
}

// '||' を含むバージョン同士の比較（含まれる最大のバージョン同士を比較する）
function compare(a: string, b: string): number[] {
  const aMax = normalize(a).split(' || ').pop() || "0.0.0";
  const bMax = normalize(b).split(' || ').pop() || "0.0.0";
  return compareSimple(aMax, bMax);
}

// SemVerベースのソート
function sort(versions: string[]): string[] {
  return [...new Set(versions)].sort((a, b) => {
    const res = compare(a, b);
    const firstDiff = res.find(d => d !== 0);
    return firstDiff !== undefined ? firstDiff : 0;
  });
}

// アップデート判定
function judgeUpOrDown(verPair: string[]): 'update' | 'downgrade' | 'same' {
  const res = compare(verPair[0], verPair[1]);
  for (const diff of res) {
    if (diff > 0) return 'downgrade';
    if (diff < 0) return 'update';
  }
  return 'same';
}

// 指定バージョン以上か判定
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
  normalize,
  compare,
  sort,
  judgeUpOrDown,
  isGreaterOrEqual
};