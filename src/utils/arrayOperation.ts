//2重配列の重複を削除する関数
export function removeDuplicate_two(strArray: string[][]): string[][] {
    const seen = new Map<string, string[]>();
    for (const arr of strArray) {
        const key = JSON.stringify(arr);
        if (!seen.has(key)) {
            seen.set(key, arr);
        }
    }
    return Array.from(seen.values());
}
