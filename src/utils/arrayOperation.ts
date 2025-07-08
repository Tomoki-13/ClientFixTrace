import { Client_Ver } from "../types/VersionCommits";
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

//Client_Ver[]のバージョン名部分だけを抽出
export function extractVersionList(data: Client_Ver[]): string[][] {
    return data.map((element) => {
        if (element.verList && element.verList.length > 1) {
            // verListからversionプロパティだけを抽出した新しい配列を返す
            return element.verList.map((ver: any) => ver.version);
        }
        return [];
    });
}