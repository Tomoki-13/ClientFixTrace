import * as fs from 'fs';
import { loadJsonData_Client_Ver } from '../../utils/loadJson';
import { MatchClientPattern } from '../../types/Item';
import { Client_Ver } from '../../types/VersionCommits';
import { cleanVersion } from '../../utils/compareVersion';

//検出されたクライアント一覧から該当するクライアントを抽出
//rawdata_filePath1の時クライアント全体で処理
function getMatchedClients(
    rawdata_filePath1: string = '',
    version_filePath2: string,
): Client_Ver[] {
    console.log("rawdata_filePath1:", rawdata_filePath1);
    //検出したクライアントリスト
    let trimmedClients:string[] = [];
    if(rawdata_filePath1 !== '') {
        trimmedClients = extractTrimmedClients(rawdata_filePath1);
    }
    return filterClientsByMode(version_filePath2, trimmedClients);
}

// バージョンを比較する関数　baseの上or下or等しいかを判定
function isVersionGreaterOrEqual(ver: string, base: string): boolean {
    const vParts = cleanVersion(ver);
    const baseParts = cleanVersion(base);
    
    for(let i = 0; i < Math.max(vParts.length, baseParts.length); i++) {
        const vNum = vParts[i] || 0;
        const baseNum = baseParts[i] || 0;
        if(vNum > baseNum) return true;
        if(vNum < baseNum) return false;
    }
    return true;
}

// client一覧をstring[]として取得する関数
function extractClients(data: MatchClientPattern[]): string[] {
    let result = data.map(item => item.client).filter((client): client is string => typeof client === 'string');
    let clientNames = result.map(path => {
        const parts = path.split('/');
        return parts.slice(-2).join('/');
    });
    console.log("clientNames:", clientNames.length);
    return clientNames;
}

// クライアント履歴を絞り込む関数
// trimmedClientsが空の場合は全てのクライアントを返す
function filterClientsByMode(
    versionFilePath: string,
    trimmedClients: string[],
): Client_Ver[] {
    const verHistory: Client_Ver[] = loadJsonData_Client_Ver(versionFilePath);
    if (trimmedClients.length === 0) {
        return verHistory;
    } else if (trimmedClients.length !== 0) {
        return verHistory.filter(item =>
            trimmedClients.some(trimmed => item.client.includes(trimmed))
        );
    }
    return [];
}

// クライアント名の絞り込み用のリスト作成
function extractTrimmedClients(filePath: string): string[] {
    const rawData: MatchClientPattern[] = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MatchClientPattern[];
    //クライアント名取得
    const clientList_detected: string[] = extractClients(rawData);
    return clientList_detected;
}

export default { getMatchedClients, isVersionGreaterOrEqual, extractClients, filterClientsByMode, extractTrimmedClients };