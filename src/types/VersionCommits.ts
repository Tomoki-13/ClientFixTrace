// クライアントの依存バージョンとコミットIDを管理する型
export interface VersionCommits {
    version: string;
    commitID: string;
    tagCommitID: string; // 後方で最近のタグのコミットID
}

export interface Client_Ver {
    client:string;
    verList:VersionCommits[];
}
export interface specificCommit {
    client: string;
    version: string;
    commitID: string;
    tagCommitID: string; 
}

// クライアント自身のリリース情報を管理する型
export interface ReleaseInfo {
    clientVersion: string;
    commitID: string;
    timestamp: string; // 時系列比較用
}
