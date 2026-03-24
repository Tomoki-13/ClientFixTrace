import fs from "fs";
import path from 'path';
import OutputJson from "../utils/output_json";
import CloneRepo from "../git/cloneRepo";
import { checkoutCommit } from "../git/checkoutCommit";
import { Client_Ver } from "../types/VersionCommits";
import pLimit from "p-limit";

/**
 * 標準的な抽出用 (clonedata/repos/standard)
 */
async function extractVersion(client_list: string[], libName: string, libNum: string = '0', state: string = ''): Promise<Client_Ver[]> {
  const std_Dir: string = path.resolve(process.cwd(), '../clonedata/repos/clientRepos/');
  OutputJson.createDir(std_Dir);

  const cloneDir = path.join(std_Dir, libName);
  OutputJson.createDir(cloneDir);

  let verHistory: Client_Ver[] = [];

  for (const client of client_list) {
    try {
      const repoPath = await CloneRepo.cloneRepo(client, cloneDir);
      if (!repoPath) {
        console.warn(`clone failure: ${client}`);
        continue;
      }
      const c_data: Client_Ver = await checkoutCommit(repoPath, libName);
      if (c_data && c_data.verList.length > 1) {
        verHistory = verHistory.concat(c_data);
      }
    } catch (error) {
      console.error(error);
    }
  }
  return verHistory;
}

/**
 * 複数データ一括実行用 (clonedata/repos/clientRepos_all)
 */
async function extractVersion_all(client_list: string[], libName: string, libNum: string = '0', state: string = ''): Promise<Client_Ver[]> {
  const cleanVersion = libNum.replace(/[^a-zA-Z0-9]/g, '');
  const originalCwd = process.cwd();
  const std_Dir: string = path.resolve(process.cwd(), '../clonedata/repos/clientRepos_all/');
  const cloneDir = path.join(std_Dir, libName, cleanVersion, state);

  if (!fs.existsSync(cloneDir)) {
    fs.mkdirSync(cloneDir, { recursive: true });
  }

  let verHistory: Client_Ver[] = [];

  for (const client of client_list) {
    try {
      const repoPath = await CloneRepo.cloneRepo(client, cloneDir);
      if (!repoPath) {
        console.warn(`clone failure: ${client}`);
        continue;
      }
      const c_data: Client_Ver = await checkoutCommit(repoPath, libName);
      if (c_data && c_data.verList.length > 1) {
        verHistory = verHistory.concat(c_data);
      }
      process.chdir(originalCwd);
    } catch (error) {
      console.error(error);
      process.chdir(originalCwd);
    }
  }
  return verHistory;
}

/**
 * マスター抽出用 (clonedata/repos/master)
 * LOOK:テスト中のため/temp/に保存するように変更しています。
 */
async function extractVersion_master(client_list: string[], libName: string): Promise<Client_Ver[]> {
  const originalCwd = process.cwd();
  const std_Dir = path.resolve(process.cwd(), '../clonedata/temp/master/');
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
 * ベンチマーク用 (clonedata/repos/master_seq 等)
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
  console.log();

  for (const res of results) {
    if (res) verHistory = verHistory.concat(res);
  }
  process.chdir(originalCwd);
  return verHistory;
}

export default {
  extractVersion,
  extractVersion_all,
  extractVersion_master,
  extractVersion_ben
};