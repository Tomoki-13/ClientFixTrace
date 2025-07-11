import * as fs from 'fs';
import { loadJsonData_Client_Ver } from '../../utils/loadJson';
import { MatchClientPattern } from '../../types/Item';
import { Client_Ver } from '../../types/VersionCommits';
import { cleanVersion } from '../../utils/compareVersion';

//検出されたクライアント一覧から該当するクライアントを抽出
//rawdata_filePathの時クライアント全体で処理
function getMatchedClients(
    rawdata_filePath: string,
    versionHistory_filePath: string,
): Client_Ver[] {
    //検出したクライアントリスト
    let trimmedClients:string[] = [];
    if(rawdata_filePath !== '') {
        trimmedClients = extractTrimmedClients(rawdata_filePath);
    }
    return filterClientsByMode(versionHistory_filePath, trimmedClients);
}

// バージョンを比較する関数　baseの上or下を判定
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
        let result = verHistory.filter(item => trimmedClients.some(trimmed => item.client.includes(trimmed)));
        let res:string[] = [];
        verHistory.forEach(element => {
            res.push(element.client);
        });
        return result;
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