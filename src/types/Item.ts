export interface Item {
    L__nameWithOwner: string;
    S__nameWithOwner: string;
    L__npm_pkg?: string;
    S__npm_pkg?: string;
    L__commit_version: string;
    S__commit_id: string;
    L__version: string;
    L__hash: string;
    state: string;
}

export interface MatchClientPattern {
    client: string;
    pattern: string[][];
    detectPattern: string[][][];
}