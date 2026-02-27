// 依存ライブラリの更新とそれに関連するクライアントのリリース情報を管理
export interface VersionCommits {
    L_libVersion: string;        // 依存ライブラリのバージョン
    C_commitID: string;          // ライブラリを更新したコミットID
    C_tagCommitID: string;       // 更新後、最も近いリリースのコミットID
    C_releaseVersion: string;    // リリース時のクライアントのバージョン
    C_preReleaseVersion: string; // リリース直前のクライアントのバージョン
}

export interface Client_Ver {
    C_client: string;            // クライアント名（user/repo）
    verList: VersionCommits[];   // バージョン変遷のリスト
}

// 特定のバージョン更新とリリースを紐付けた抽出データ（Detect用）
export interface specificCommit {
    C_client: string;            // クライアント名
    L_libName: string;           // 検索対象のライブラリ名
    L_targetVersion: string;     // mydata.json で指定したターゲットバージョン
    L_preLibVersion: string;     // 更新前のライブラリバージョン
    L_postLibVersion: string;    // 更新後のライブラリバージョン
    C_commitID: string;          // 依存ライブラリ更新時のコミットID
    C_tagCommitID: string;       // 更新後のリリースコミットID
}

// 内部処理用のリリース履歴データ
export interface ReleaseInfo {
    C_version: string;           // クライアント自身の新バージョン
    C_preVersion: string;        // クライアント自身の旧バージョン
    C_commitID: string;          // バージョンが更新されたコミットID
    timestamp: string;           // 時系列比較用
}