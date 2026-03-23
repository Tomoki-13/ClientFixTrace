import * as fs from 'fs';
import LoadJson from './loadJson';
import CompareVersion from './compareVersion';
import { MatchClientPattern } from '../types/Item';
import { Client_Ver } from '../types/VersionCommits';

/**
 * 検出されたクライアント一覧から該当するクライアントを抽出する
 */
function get(
  matched_filePath: string,
  versionHistory_filePath: string,
): Client_Ver[] {
  let trimmedClients: string[] = [];
  if (matched_filePath !== '') {
    trimmedClients = extractTrimmed(matched_filePath);
  }
  return filterByMode(versionHistory_filePath, trimmedClients);
}

/**
 * バージョンを比較し、verがbase以上であるか判定する
 */
function isVersionGreaterOrEqual(ver: string, base: string): boolean {
  const vParts = CompareVersion.clean(ver);
  const baseParts = CompareVersion.clean(base);

  for (let i = 0; i < Math.max(vParts.length, baseParts.length); i++) {
    const vNum = vParts[i] || 0;
    const baseNum = baseParts[i] || 0;
    if (vNum > baseNum) return true;
    if (vNum < baseNum) return false;
  }
  return true;
}

/**
 * MatchClientPattern配列からクライアント名の配列を抽出する
 */
function extract(data: MatchClientPattern[]): string[] {
  let result = data.map(item => item.client).filter((client): client is string => typeof client === 'string');
  let clientNames = result.map(path => {
    const parts = path.split('/');
    return parts.slice(-2).join('/');
  });
  return clientNames;
}

/**
 * クライアント履歴をtrimmedClientsに基づいて絞り込む
 */
function filterByMode(
  versionFilePath: string,
  trimmedClients: string[],
): Client_Ver[] {
  const verHistory: any[] = LoadJson.clientVer(versionFilePath);
  if (trimmedClients.length === 0) {
    return verHistory as Client_Ver[];
  }
  // 互換性確保のためのフィルタリング
  const result = verHistory.filter(item => {
    const clientName = item.C_client || item.client;
    if (!clientName) return false;
    return trimmedClients.some(trimmed => clientName.includes(trimmed));
  });

  return result as Client_Ver[];
}

/**
 * クライアント名の絞り込み用のリストを作成
 */
function extractTrimmed(filePath: string): string[] {
  const matched: MatchClientPattern[] = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MatchClientPattern[];
  const clientList_detected: string[] = extract(matched);
  return clientList_detected;
}

export default {
  get,
  isVersionGreaterOrEqual,
  extract,
  filterByMode,
  extractTrimmed,
};