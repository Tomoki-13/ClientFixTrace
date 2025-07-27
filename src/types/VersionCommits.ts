export interface VersionCommits {
    version: string;
    commit: string;
}

export interface Client_Ver {
    client:string;
    verList:VersionCommits[];
}
export interface specificCommit {
    client: string;
    version: string;
    commit: string;
}