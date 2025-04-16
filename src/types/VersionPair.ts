export interface VersionPair {
    type: string;//アップデートの種類
    from: string;// 更新前のバージョン
    to: string;  // 更新後のバージョン
    count:number;  //切り替えたクライアント数
}