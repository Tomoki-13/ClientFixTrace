import * as fs from 'fs';
import { loadJsonData_Client_Ver } from '../../utils/loadJson';
import { MatchClientPattern } from '../../types/Item';
import { Client_Ver } from '../../types/VersionCommits';
import { cleanVersion } from '../../utils/compareVersion';

/**
 * 検出されたクライアント一覧から該当するクライアントを抽出する
 * 
 * @param {string} matched_filePath - 検出されたクライアント情報が格納されたJSONファイルのパス
 * @param {string} versionHistory_filePath - クライアントのバージョン履歴が格納されたJSONファイルのパス
 * @returns {Client_Ver[]} 抽出されたクライアント情報のリスト
 */
function getMatchedClients(
    matched_filePath: string,
    versionHistory_filePath: string,
): Client_Ver[] {
    //検出したクライアントリスト
    let trimmedClients:string[] = [];
    if(matched_filePath !== '') {
        trimmedClients = extractTrimmedClients(matched_filePath);
    }
    return filterClientsByMode(versionHistory_filePath, trimmedClients);
}

/**
 * バージョンを比較し、verがbase以上であるか判定する
 * 
 * @param {string} ver - 比較する対象のバージョン
 * @param {string} base - 基準となるバージョン
 * @returns {boolean} verがbase以上ならtrue
 */
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

/**
 * MatchClientPattern配列からクライアント名の配列を抽出する
 * 
 * @param {MatchClientPattern[]} data - クライアントパターンの配列
 * @returns {string[]} クライアント名の配列
 */
function extractClients(data: MatchClientPattern[]): string[] {
    let result = data.map(item => item.client).filter((client): client is string => typeof client === 'string');
    let clientNames = result.map(path => {
        const parts = path.split('/');
        return parts.slice(-2).join('/');
    });
    return clientNames;
}

/**
 * クライアント履歴をtrimmedClientsに基づいて絞り込む
 * trimmedClientsが空の場合は全クライアントを返す
 * 
 * @param {string} versionFilePath - クライアントのバージョン履歴が格納されたJSONファイルのパス
 * @param {string[]} trimmedClients - 抽出対象のクライアント名リスト
 * @returns {Client_Ver[]} フィルタリングされたクライアント履歴
 */
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

/**
 * クライアント名の絞り込み用のリストを作成
 * 
 * @param {string} filePath - 検出されたクライアント情報JSONのパス
 * @returns {string[]} 抽出されたクライアント名の配列
 */
function extractTrimmedClients(filePath: string): string[] {
    const matched: MatchClientPattern[] = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MatchClientPattern[];
    //クライアント名取得
    const clientList_detected: string[] = extractClients(matched);
    return clientList_detected;
}

export default { 
    getMatchedClients,
    isVersionGreaterOrEqual,
    extractClients,
    filterClientsByMode,
    extractTrimmedClients,
};