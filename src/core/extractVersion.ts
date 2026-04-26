// extractVersion.ts
import fs from "fs";
import path from 'path';
import OutputJson from "../utils/output_json";
import CloneRepo from "../git/cloneRepo";
import { checkoutCommit } from "../git/checkoutCommit";
import { Client_Ver } from "../types/VersionCommits";
import pLimit from "p-limit";

/**
 * 【本番用】リポジトリの並列クローンと履歴抽出（原本キャッシュの作成）
 * * 指定されたクライアント群を原本ディレクトリにクローン（既に存在する場合は再利用）し、
 * 依存ライブラリの更新履歴とリリースタグの情報を抽出します。
 * * - 保存先: `../clonedata/clientRepos/{libName}/{clientName}` （システム共通の永続キャッシュ）
 * - 実行方式: `p-limit` を用いた並列処理 (最大並列数: 5) により高速に抽出
 */
async function extractVersion_master(client_list: string[], libName: string): Promise<Client_Ver[]> {
  const originalCwd = process.cwd();
  // 抽出先を統合された永続原本キャッシュディレクトリに指定
  const std_Dir = path.resolve(process.cwd(), '../../clonedata/clientRepos/');
  const cloneDir = path.join(std_Dir, libName);

  if (!fs.existsSync(cloneDir)) {
    fs.mkdirSync(cloneDir, { recursive: true });
  }

  let verHistory: Client_Ver[] = [];
  let count = 0;
  const limit = pLimit(5);

  const promises = client_list.map(client => limit(async () => {
    try {
      const repoPath = await CloneRepo.cloneRepo(client, cloneDir);
      if (!repoPath) {
        console.warn(`  [Warn] clone failure: ${client}`);
        return null;
      }
      const c_data: Client_Ver = await checkoutCommit(repoPath, libName);
      return (c_data && c_data.verList.length > 1) ? c_data : null;
    } catch (error) {
      console.error(`  [Error] ${client}:`, error);
      return null;
    } finally {
      count++;
      if (count % 5 === 0 || count === client_list.length) {
        console.log(`  Progress: ${count} / ${client_list.length} clients processed.`);
      }
    }
  }));

  const results = await Promise.all(promises);
  for (const res of results) {
    if (res) verHistory = verHistory.concat(res);
  }
  process.chdir(originalCwd);
  return verHistory;
}

/**
 * 【テスト・ベンチマーク用】実行速度算出用
 * * 本番のキャッシュ領域(`clientRepos`)を汚さずに、任意のディレクトリ(`temp`)へクローンして
 * 抽出のパフォーマンステストや一時的な検証を行うための関数です。
 * * - 保存先: `../../clonedata/temp/{dirSuffix}/{libName}/{clientName}`
 * - 実行方式: `p-limit` を用いた並列処理 (並列数を引数 `concurrency` で柔軟に指定可能)
 */
async function extractVersion_ben(
  client_list: string[],
  libName: string,
  concurrency: number = 5,
  dirSuffix: string = ''
): Promise<Client_Ver[]> {
  const originalCwd = process.cwd();
  const std_Dir = path.resolve(process.cwd(), `../../clonedata/temp/${dirSuffix}/`);
  const cloneDir = path.join(std_Dir, libName);

  if (!fs.existsSync(cloneDir)) {
    fs.mkdirSync(cloneDir, { recursive: true });
  }

  let verHistory: Client_Ver[] = [];
  let count = 0;
  const total = client_list.length;
  const limit = pLimit(concurrency);

  const promises = client_list.map(client => limit(async () => {
    try {
      const repoPath = await CloneRepo.cloneRepo(client, cloneDir);
      if (!repoPath) {
        process.stdout.write(`\r\x1b[K  [Warn] clone failure: ${client}\n`);
        return null;
      }
      const c_data: Client_Ver = await checkoutCommit(repoPath, libName);
      return (c_data && c_data.verList.length > 1) ? c_data : null;
    } catch (error) {
      process.stdout.write(`\r\x1b[K  [Error] ${client}: ${error}\n`);
      return null;
    } finally {
      count++;
      const percent = ((count / total) * 100).toFixed(1);
      process.stdout.write(`\r\x1b[K  Progress: ${count} / ${total} clients processed. (${percent}%)`);
    }
  }));

  const results = await Promise.all(promises);
  console.log(); // ベンチマークログの改行用

  for (const res of results) {
    if (res) verHistory = verHistory.concat(res);
  }
  process.chdir(originalCwd);
  return verHistory;
}

export default {
  extractVersion_master,
  extractVersion_ben
};