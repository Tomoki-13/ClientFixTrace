//バージョンを昇順に比較
export const compareVersions = (a: string, b: string): number[] => {
    let result:number[] = [];
    const a_num:number[] = cleanVersion(a);
    const b_num:number[]  = cleanVersion(b);
    for (let i = 0; i < Math.max(a_num.length, b_num.length); i++) {
        const numA = a_num[i] || 0;
        const numB = b_num[i] || 0;
        result[i] = numA - numB;
    }
    return result;
}

export function cleanVersion(ver: string): number[] {
    let result = ver
            .trim()
            .replace(/^[\^~><= ]+/, '')
            .split('-')[0]
            .split('.')
            .map(num => parseInt(num, 10));    
    return result;
};

//バージョン更新がupdate, downgrade, sameの判定
export const judge_up_or_down = (ver_pair: string[]): string => {
    if(ver_pair.length !== 2) {
        throw new Error('Invalid version pair');
    } else {
        //pre:更新前バージョン，post:更新後バージョン
        const pre_verNum0:number[] = cleanVersion(ver_pair[0]);
        const post_verNum1:number[] = cleanVersion(ver_pair[1]);

        for(let i = 0; i < pre_verNum0.length; i++) {
            const preNum = pre_verNum0[i];
            const postNum = post_verNum1[i];
            if(preNum > postNum) return 'downgrade';
            if(preNum < postNum) return 'update';
        }
        //どの数字にも差がない場合は同じバージョン
        return 'same';
    }
    return 'error'
};