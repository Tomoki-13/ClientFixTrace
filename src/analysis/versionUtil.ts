// src/analysis/versionUtil.ts

/**
 * バージョン文字列の操作・比較・ソートに関する共通ユーティリティクラス
 */
export default class VersionUtil {
  /**
   * 文字列から数値配列へクリーンアップします。
   * 例: "^8.2.x" -> [8, 2, 0]
   */
  static clean(ver: string): number[] {
    if (!ver || typeof ver !== 'string') return [0, 0, 0];
    const base = ver.trim().replace(/^[\^~><= ]+/, '').split('-')[0];
    return base.split('.').map(num => {
      const parsed = parseInt(num, 10);
      return isNaN(parsed) ? 0 : parsed; // 'x' や '*' などの文字は 0 に変換
    });
  }

  /**
   * 単純な1対1の数値配列比較を行う内部メソッドです。
   * @private
   */
  private static compareSimple(a: string, b: string): number[] {
    const aNum = this.clean(a);
    const bNum = this.clean(b);
    const maxLength = Math.max(aNum.length, bNum.length);
    const result: number[] = [];
    
    for (let i = 0; i < maxLength; i++) {
      result[i] = (aNum[i] || 0) - (bNum[i] || 0);
    }
    return result;
  }

  /**
   * バージョンの「正規化」を行います。
   * OR条件 (||) が含まれる場合は、記載されている最大のバージョンを基準にします。
   * 例: "^8.2.0 || ^9.0" -> "9.0.0"
   */
  static normalize(ver: string): string {
    if (!ver || ver === "not_found" || ver === "none" || ver === "unknown") {
      return "0.0.0";
    }
    
    // '||' で分割し、最後の要素（最大バージョン）を採用
    const cleanVer = ver.trim().split('||').pop()!.trim().replace(/^[\\^~><= ]+/, '').split('-')[0];
    const parts = cleanVer.split('.');
    
    // 必ず Major.Minor.Patch の3桁に揃える
    const major = parts[0] || "0";
    const minor = parts[1] || "0";
    const patch = parts[2] || "0";
    
    return `${major}.${minor}.${patch}`;
  }

  /**
   * 2つのバージョンを比較し、差分の数値配列を返します。
   */
  static compare(a: string, b: string): number[] {
    const aNorm = this.normalize(a);
    const bNorm = this.normalize(b);
    return this.compareSimple(aNorm, bNorm);
  }

  /**
   * SemVerベースでバージョン文字列の配列を昇順（古い順）にソートします。
   * 重複は自動的に排除されます。
   */
  static sort(versions: string[]): string[] {
    return [...new Set(versions)].sort((a, b) => {
      const res = this.compare(a, b);
      const firstDiff = res.find(d => d !== 0);
      return firstDiff !== undefined ? firstDiff : 0;
    });
  }

  /**
   * 更新前後のペアを渡し、バージョンの推移種別を判定します。
   * @param verPair [古いバージョン, 新しいバージョン] の配列
   * @returns 'update' (上がった) | 'downgrade' (下がった) | 'same' (変化なし)
   */
  static judgeUpOrDown(verPair: [string, string]): 'update' | 'downgrade' | 'same' {
    const res = this.compare(verPair[0], verPair[1]);
    for (const diff of res) {
      if (diff > 0) return 'downgrade'; // 古い方が大きい＝下がった
      if (diff < 0) return 'update';    // 古い方が小さい＝上がった
    }
    return 'same';
  }

  /**
   * ダウングレード（ロールバック）されているかを判定します。
   * (各フェーズのスナップショット解析用)
   * * @param currentVer - 判定対象の現在のバージョン (例: release_1 の時のバージョン)
   * @param targetVer - 比較基準となる更新ターゲットバージョン (例: postVersion)
   * @returns 基準より古いバージョンに下がっていれば true
   */
  static isDowngraded(currentVer: string, targetVer: string): boolean {
    if (!currentVer || currentVer === "not_found" || currentVer === "unknown") {
      return false;
    }
    // currentVer を [1] (新しい方) として渡し、下がったかを見る
    return this.judgeUpOrDown([targetVer, currentVer]) === 'downgrade';
  }

  /**
   * 第一引数のバージョンが、第二引数（基準）以上であるかを判定します。
   */
  static isGreaterOrEqual(ver: string, base: string): boolean {
    const res = this.compare(ver, base);
    for (const diff of res) {
      if (diff > 0) return true;
      if (diff < 0) return false;
    }
    return true; // 完全に一致した場合
  }
}