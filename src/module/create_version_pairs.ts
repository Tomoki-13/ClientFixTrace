import { rejects } from "assert";
import { VersionPair } from "../types/VersionPair";
//[[1.1.0,2.0.0,2.1.1],[2.0.0,3.0.0,4.0.0,5.0.0]]のようなクライアントごとのバージョン結果が出力
export const create_version_pairs = (verList: string[][]): VersionPair[] => {
    let result_pairs: VersionPair[] = [];

    //出現度調査のためのペアを作成 例：[[['1.0.0','2.0.0','3.0.0']]→[[1.0.0,2.0.0],[2.0.0,3.0.0]]
    let pairs:string[][] = [];
    for(const ver of verList) {
        for(let i = 0; i < ver.length; i++) {
            if(ver.length < i + 2) {
                break;   
            }
            pairs.push(ver.slice(i, i + 2))
        }
    }

    //出現数カウント
    const pairCount = new Map<string, number>();
    for (const pair of pairs) {
        const key = JSON.stringify(pair);
        pairCount.set(key, (pairCount.get(key) || 0) + 1);
    }

    //出現度出力のために一意なペア(重複削除)を作成・ソート
    let uni_pairs: string[][] = removeDuplicate_two(pairs);
    uni_pairs.sort((a: string[], b: string[]) => {
        // a[0],b[0]が同じ場合はa[1],b[1]で比較して整列
        const first = compareVersions(a[0], b[0]);
        if (first !== 0) {
            return first;
        }else{
            return compareVersions(a[1], b[1]);
        }
    });

    uni_pairs.forEach(element => {
        result_pairs.push({
            type: judge_up_or_down(element),
            from: element[0],
            to: element[1],
            count: pairCount.get(JSON.stringify(element)) || 0
        });
    });

    return result_pairs;
}

//^の除去と数値に変換
const toNumber = (ver_str: string): number => {
    //^の除去と数値に変換
    if (ver_str[0].match(/[^1-9]/)) {
        let verStr: string = [...ver_str].slice(1).join("");
        return Number(verStr.split('.').join(''));
    } else {
        return Number(ver_str.split('.').join(''));
    }
}

//バージョンを昇順に比較
const compareVersions = (a: string, b: string): number => {
    const a_num:number = toNumber(a);
    const b_num:number  = toNumber(b);
    return a_num - b_num;
}

//バージョン更新がupdate, downgrade, sameの判定
const judge_up_or_down = (ver_pair: string[]): string => {
    if(ver_pair.length !== 2) {
        throw new Error('Invalid version pair');
    } else {
        const verNum0:number = toNumber(ver_pair[0]);
        const verNum1:number = toNumber(ver_pair[1]);

        if(verNum0 < verNum1) {
            return 'update';
        } else if(verNum0 > verNum1) {
            return 'downgrade';
        } else if(verNum0 === verNum1) {
            return 'same';
        }
    }
    return 'error'
};

//2重配列の重複を削除する関数
function removeDuplicate_two(strArray: string[][]): string[][] {
    const seen = new Map<string, string[]>();
    for (const arr of strArray) {
        const key = JSON.stringify(arr);
        if (!seen.has(key)) {
            seen.set(key, arr);
        }
    }
    return Array.from(seen.values());
}

// テスト環境のときだけ export
export const _privateForTest = { judge_up_or_down };