/**
 * 文字列から数値配列へクリーンアップする。
 * 例: "^8.2.x" -> [8, 2, 0]
 */
function clean(ver: string): number[] {
  if (!ver || typeof ver !== 'string') return [0, 0, 0];
  const base = ver.trim().replace(/^[\^~><= ]+/, '').split('-')[0];
  return base.split('.').map(num => {
    const parsed = parseInt(num, 10);
    return isNaN(parsed) ? 0 : parsed;
  });
}

/** 正規化済みバージョン文字列の数値比較（モジュール内部専用）*/
function compareSimple(a: string, b: string): number[] {
  const aNum = clean(a);
  const bNum = clean(b);
  const maxLength = Math.max(aNum.length, bNum.length);
  const result: number[] = [];
  for (let i = 0; i < maxLength; i++) {
    result[i] = (aNum[i] || 0) - (bNum[i] || 0);
  }
  return result;
}

/**
 * バージョンの「正規化」を行う。
 * OR条件 (||) が含まれる場合は、記載されている最大のバージョンを基準にする。
 * 例: "^8.2.0 || ^9.0" -> "9.0.0"
 */
function normalize(ver: string): string {
  if (!ver || ver === "not_found" || ver === "none" || ver === "unknown") {
    return "0.0.0";
  }
  const cleanVer = ver.trim().split('||').pop()!.trim().replace(/^[\\^~><= ]+/, '').split('-')[0];
  const parts = cleanVer.split('.');
  return `${parts[0] || "0"}.${parts[1] || "0"}.${parts[2] || "0"}`;
}

/**
 * 2つのバージョンを比較し、差分の数値配列を返す。
 */
function compare(a: string, b: string): number[] {
  return compareSimple(normalize(a), normalize(b));
}

/**
 * SemVerベースでバージョン文字列の配列を昇順（古い順）にソートする。
 * 重複は自動的に排除される。
 */
function sort(versions: string[]): string[] {
  return [...new Set(versions)].sort((a, b) => {
    const res = compare(a, b);
    const firstDiff = res.find(d => d !== 0);
    return firstDiff !== undefined ? firstDiff : 0;
  });
}

/**
 * 更新前後のペアを渡し、バージョンの推移種別を判定する。
 * @returns 'update' (上がった) | 'downgrade' (下がった) | 'same' (変化なし)
 */
function judgeUpOrDown(verPair: [string, string]): 'update' | 'downgrade' | 'same' {
  const res = compare(verPair[0], verPair[1]);
  for (const diff of res) {
    if (diff > 0) return 'downgrade';
    if (diff < 0) return 'update';
  }
  return 'same';
}

/**
 * ダウングレード（ロールバック）されているかを判定する。
 * @param currentVer 判定対象の現在のバージョン (例: release_1 の時点)
 * @param targetVer  比較基準となる更新ターゲットバージョン (例: postVersion)
 */
function isDowngraded(currentVer: string, targetVer: string): boolean {
  if (!currentVer || currentVer === "not_found" || currentVer === "unknown") return false;
  return judgeUpOrDown([targetVer, currentVer]) === 'downgrade';
}

/**
 * 第一引数のバージョンが第二引数（基準）以上であるかを判定する。
 */
function isGreaterOrEqual(ver: string, base: string): boolean {
  const res = compare(ver, base);
  for (const diff of res) {
    if (diff > 0) return true;
    if (diff < 0) return false;
  }
  return true;
}

export default { clean, normalize, compare, sort, judgeUpOrDown, isDowngraded, isGreaterOrEqual };
