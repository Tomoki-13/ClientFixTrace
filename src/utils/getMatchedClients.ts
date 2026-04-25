import * as fs from 'fs';
import LoadJson from './loadJson';
import CompareVersion from '../analysis/compareVersion';
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
 * MatchClientPattern配列からクライアント名の配列を抽出・ユニーク化する
 */
function extract(data: MatchClientPattern[]): string[] {
  const clientNames = data
    .map(item => item.client)
    .filter((client): client is string => typeof client === 'string')
    .map(path => {
      const parts = path.split('/');
      return parts.slice(-2).join('/');
    });

  return Array.from(new Set(clientNames));
}

/**
 * クライアント履歴をtrimmedClientsに基づいて絞り込む
 */
function filterByMode(
  versionFilePath: string,
  trimmedClients: string[],
): Client_Ver[] {
  const verHistory: any[] = LoadJson.clientVer(versionFilePath);

  // LOOK: 抽出対象が0件なら、全件返すのではなく空配列を返す
  if (trimmedClients.length === 0) {
    return [];
  }

  const result = verHistory.filter(item => {
    const clientName = item.C_client || item.client;
    if (!clientName) return false;
    return trimmedClients.some(trimmed => clientName.includes(trimmed));
  });

  return result as Client_Ver[];
}

function extractTrimmed(filePath: string): string[] {
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const matched = JSON.parse(fileContent) as unknown as MatchClientPattern[];
  return extract(matched);
}

export default {
  get,
  extract,
  filterByMode,
  extractTrimmed,
};