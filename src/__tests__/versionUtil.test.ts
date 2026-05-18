// src/analysis/__tests__/versionUtil.test.ts

import VersionUtil from "../analysis/versionUtil";

describe("VersionUtil", () => {
  describe("normalize()", () => {
    test("プレフィックス記号や空白を正しく除去できる", () => {
      expect(VersionUtil.normalize("^5.2.1")).toBe("5.2.1");
      expect(VersionUtil.normalize("~ 1.0.0")).toBe("1.0.0");
      expect(VersionUtil.normalize(">=2.0.0")).toBe("2.0.0");
    });

    test("不足している桁（MinorやPatch）を 0 で補完できる", () => {
      expect(VersionUtil.normalize("5")).toBe("5.0.0");
      expect(VersionUtil.normalize("5.2")).toBe("5.2.0");
    });

    test("プレリリース文字列（-alphaなど）を除去できる", () => {
      expect(VersionUtil.normalize("6.0.0-beta.1")).toBe("6.0.0");
    });

    test("OR条件 (||) が含まれる場合、右側の最大バージョンを採用する", () => {
      expect(VersionUtil.normalize("^8.2.0 || ^9.0")).toBe("9.0.0");
    });

    test("不正な文字列の場合は 0.0.0 を返す", () => {
      expect(VersionUtil.normalize("unknown")).toBe("0.0.0");
      expect(VersionUtil.normalize("not_found")).toBe("0.0.0");
      expect(VersionUtil.normalize("")).toBe("0.0.0");
    });
  });

  describe("judgeUpOrDown()", () => {
    test("バージョンが上がった場合は 'update' を返す", () => {
      expect(VersionUtil.judgeUpOrDown(["1.0.0", "1.1.0"])).toBe("update");
      expect(VersionUtil.judgeUpOrDown(["1.9.9", "2.0.0"])).toBe("update");
    });

    test("バージョンが下がった場合は 'downgrade' を返す", () => {
      expect(VersionUtil.judgeUpOrDown(["1.2.0", "1.1.0"])).toBe("downgrade");
      expect(VersionUtil.judgeUpOrDown(["2.0.0", "1.9.9"])).toBe("downgrade");
    });

    test("バージョンが変化していない場合は 'same' を返す", () => {
      expect(VersionUtil.judgeUpOrDown(["1.1.0", "1.1.0"])).toBe("same");
    });
  });

  describe("isDowngraded()", () => {
    test("基準バージョンより古いバージョンに下がった場合は true を返す", () => {
      // 基準 5.2.1 に対して 5.1.0 にロールバックしている
      expect(VersionUtil.isDowngraded("5.1.0", "5.2.1")).toBe(true);
      expect(VersionUtil.isDowngraded("4.9.9", "5.2.1")).toBe(true);
    });

    test("基準バージョンを維持、またはアップグレードした場合は false を返す", () => {
      // 基準維持
      expect(VersionUtil.isDowngraded("5.2.1", "5.2.1")).toBe(false);
      // さらに新しいバージョンへ
      expect(VersionUtil.isDowngraded("5.3.0", "5.2.1")).toBe(false);
      expect(VersionUtil.isDowngraded("6.0.0", "5.2.1")).toBe(false);
    });

    test("unknown などの異常値が渡された場合は安全に false を返す", () => {
      expect(VersionUtil.isDowngraded("unknown", "5.2.1")).toBe(false);
    });
  });

  describe("sort()", () => {
    test("バージョン文字列の配列を正しく昇順にソートし、重複を排除する", () => {
      const versions = ["1.10.0", "1.2.0", "1.2.0", "2.0.0", "1.0.1"];
      const expected = ["1.0.1", "1.2.0", "1.10.0", "2.0.0"];
      expect(VersionUtil.sort(versions)).toEqual(expected);
    });
  });
});