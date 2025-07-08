import { VersionPair } from "../types/VersionPair";
import fs from "fs";
import path from 'path';
import output_json from "../utils/output_json";
import { removeDuplicate_two } from "../utils/arrayOperation";
import { compareVersions, judge_up_or_down} from "../utils/compareVersion";

//[[1.1.0,2.0.0,2.1.1],[2.0.0,3.0.0,4.0.0,5.0.0]]のようなクライアントごとのバージョン結果が出力
//クライアントごとにバージョン履歴を取得する 0：クライアント内の重複あり　１：クライアント内の重複なし
export const create_version_pairs = (verList: string[][],libName:string,mode:number = 0): VersionPair[] => {
    let result_pairs: VersionPair[] = [];

    //出現度調査のためのペアを作成 例：[['1.0.0','2.0.0','3.0.0']]→[[1.0.0,2.0.0],[2.0.0,3.0.0]]
    let pairs:string[][] = [];
    if(mode === 0) {
        for(const ver of verList) {
            for(let i = 0; i < ver.length; i++) {
                if(ver.length < i + 2) {
                    break;   
                }
                pairs.push(ver.slice(i, i + 2))
            }
        }
    }else if(mode === 1) {
        //クライアントごとにペア作り
        for(const ver of verList) {
            let uni_pairs: string[][] = [];
            for(let i = 0; i < ver.length; i++) {
                if(ver.length < i + 2) {
                    break;   
                }
                uni_pairs.push(ver.slice(i, i + 2))
            }
            //クライアント内で[[1.1.1,2.0.0],[1.1.1,2.0.0]]→[[1.1.1,2.0.0]]のような重複を削除
            pairs = pairs.concat(removeDuplicate_two(uni_pairs));
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
    //a = [1.1.0,2.0.0], b = [2.0.0,3.0.0]のようなペア
    uni_pairs.sort((a: string[], b: string[]) => {
        // a[0],b[0]が同じ場合はa[1],b[1]で比較して整列
        const first:number[] = compareVersions(a[0], b[0]);
        for (let i = 0; i < first.length; i++) {
            if (first[i] !== 0) return first[i];  // 差がついた最初の要素を返す（負ならaが前、正ならbが前）
        }
        const second: number[] = compareVersions(a[1], b[1]);
        for (let i = 0; i < second.length; i++) {
            if (second[i] !== 0) return second[i];
        }
        return 0;
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