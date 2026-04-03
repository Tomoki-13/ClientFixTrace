import fs from "fs";
import path from "path";
import { Item } from "./types/Item";
import { VersionPair } from "./types/VersionPair";

// utils・core はすべてオブジェクトとしてインポート
import LoadJson from "./utils/loadJson";
import ExtractVersion from "./core/extractVersion";
import CreateVersionPairs from "./core/create_version_pairs";
import ArrayOperation from "./utils/arrayOperation";
import OutputJson from "./utils/output_json";

// ==========================================
// INPUT: 実行設定
// ==========================================
const CONFIG = {
  MODE: 'full' as 'extract' | 'analyze' | 'full',
  TEST_RESULT_PATH: '../datasets/test_result.json',
  OUTPUT_CLONE_RESULT_DIR: '../output/cloneResult',
  OUTPUT_VERSION_DATA_DIR: '../output/versionData',
  OUTPUT_SORT_DATA_DIR: '../output/sortData',
  ANALYZE_TARGET_HISTORY_PATH: '../output/versionData/2026-03-01-12-00-00/success/libname/version_history-success-100total.json'
};
// ==========================================

interface TargetUpdate {
  libName: string;
  preVersion: string;
  postVersion: string;
}

function extractUpdatesFromResults(testResults: Item[]): TargetUpdate[] {
  const updatesMap = new Map<string, TargetUpdate>();
  const libClientMap = new Map<string, Map<string, Item[]>>();

  for (const record of testResults) {
    const lib = record.L__nameWithOwner;
    const client = record.S__nameWithOwner;

    if (!libClientMap.has(lib)) libClientMap.set(lib, new Map());
    const clientMap = libClientMap.get(lib)!;

    if (!clientMap.has(client)) clientMap.set(client, []);
    clientMap.get(client)!.push(record);
  }

  for (const [lib, clientMap] of libClientMap.entries()) {
    for (const [client, records] of clientMap.entries()) {
      const versions = [...new Set(records.map(r => r.L__version))].sort((a, b) => {
        const parseVer = (v: string) => {
          const dashIdx = v.indexOf('-');
          const main = dashIdx > -1 ? v.slice(0, dashIdx) : v;
          const pre = dashIdx > -1 ? v.slice(dashIdx + 1) : '';
          return { parts: main.split('.').map(Number), pre };
        };

        const vA = parseVer(a);
        const vB = parseVer(b);

        for (let i = 0; i < Math.max(vA.parts.length, vB.parts.length); i++) {
          const numA = vA.parts[i] || 0;
          const numB = vB.parts[i] || 0;
          if (numA !== numB) return numA - numB;
        }

        if (vA.pre && !vB.pre) return -1;
        if (!vA.pre && vB.pre) return 1;
        if (vA.pre && vB.pre) return vA.pre.localeCompare(vB.pre, undefined, { numeric: true, sensitivity: 'base' });
        return 0;
      });

      if (versions.length >= 2) {
        for (let i = 0; i < versions.length - 1; i++) {
          const oldV = versions[i];
          const newV = versions[i + 1];

          const hasOldSuccess = records.some(r => r.L__version === oldV && r.state === 'success');

          if (hasOldSuccess) {
            const key = `${lib}_${oldV}_${newV}`;
            if (!updatesMap.has(key)) {
              const libName = (records.find(r => r.L__version === newV) as any)?.L__npm_pkg || lib;
              updatesMap.set(key, { libName, preVersion: oldV, postVersion: newV });
            }
          }
        }
      }
    }
  }
  return Array.from(updatesMap.values());
}

async function saveAndAnalyzeData(libTask: TargetUpdate, state: string, dateStr: string, mode: string, verHistory: any[] = [], targetPath: string = "") {
  const { libName, preVersion, postVersion } = libTask;
  const outputDir = path.resolve(process.cwd(), `${CONFIG.OUTPUT_VERSION_DATA_DIR}/${dateStr}/${state}/${libName}-${postVersion}`);
  let population = 0;

  if ((mode === 'extract' || mode === 'full') && verHistory.length > 0) {
    population = verHistory.length;
    OutputJson.createDir(outputDir);
    const historyPath = OutputJson.getUniquePath(outputDir, `version_history-${state}`, `${population}total`);
    fs.writeFileSync(historyPath, JSON.stringify(verHistory, null, 2));
    console.log(`[Extract] Saved ${population} histories for ${state}.`);
  }

  if (mode === 'analyze' || mode === 'full') {
    if (mode === 'analyze' && targetPath.length > 0) {
      console.log(`[Analyze] Loading existing file: ${targetPath}`);
      verHistory = await LoadJson.clientVer(targetPath);
    }

    population = verHistory.length;

    if (population > 0) {
      const inputList = ArrayOperation.extractVersionList(verHistory);
      const pairs = CreateVersionPairs.create_version_pairs(inputList, libName, 1);

      const updateCount = pairs.filter(p => p.type === 'update').reduce((sum, p) => sum + p.count, 0);
      const countSuffix = `${updateCount}updated-${population}total`;

      OutputJson.createDir(outputDir);
      const pairPath = OutputJson.getUniquePath(outputDir, `result_pairs-${state}`, countSuffix);
      fs.writeFileSync(pairPath, JSON.stringify(pairs, null, 2));

      Classify_types(pairs, libName, postVersion, dateStr, state, `${population}total`);
      console.log(`[Analyze] Classification completed for ${state}: ${countSuffix}`);
    } else {
      console.log(`[Analyze] No history data to analyze for ${state}.`);
    }
  }
}

function Classify_types(data: VersionPair[], libName: string, postLibVersion: string, dateStr: string, state: string, total: string): void {
  data = [...data].sort((a, b) => b.count - a.count);
  let outDir = path.join(`${CONFIG.OUTPUT_SORT_DATA_DIR}`, dateStr, state, `${libName}-${postLibVersion}`);
  OutputJson.createDir(outDir);

  const types: ('update' | 'downgrade' | 'same')[] = ['update', 'downgrade', 'same'];
  types.forEach(type => {
    const filteredData = data.filter((item) => item.type === type);
    const outputPath = OutputJson.getUniquePath(outDir, '', `${filteredData.length}${type}_${total}`);
    fs.writeFileSync(outputPath, JSON.stringify(filteredData, null, 2));
  });
}

function appendCloneLog(logPaths: string[], libName: string, preVer: string, postVer: string, succCount: number, failCount: number, status: string, durationSec: number) {
  const logLine = `${libName},${preVer},${postVer},${succCount},${failCount},${status},${durationSec.toFixed(2)}\n`;
  for (const logPath of logPaths) {
    fs.appendFileSync(logPath, logLine, 'utf8');
  }
}

(async () => {
  const now = new Date();
  const dateStr = OutputJson.formatDateTime(now);

  const mode = CONFIG.MODE;

  const cloneResultDir = path.resolve(process.cwd(), `${CONFIG.OUTPUT_CLONE_RESULT_DIR}/${dateStr}`);
  OutputJson.createDir(cloneResultDir);

  const versionDataRoot = path.resolve(process.cwd(), `${CONFIG.OUTPUT_VERSION_DATA_DIR}/${dateStr}`);
  OutputJson.createDir(versionDataRoot);

  const validCloneLogPath = path.join(cloneResultDir, 'valid_clone_summary.csv');
  const invalidCloneLogPath = path.join(cloneResultDir, 'invalid_clone_summary.csv');

  const validVersionDataLogPath = path.join(versionDataRoot, 'valid_clone_summary.csv');
  const invalidVersionDataLogPath = path.join(versionDataRoot, 'invalid_clone_summary.csv');

  const csvHeader = 'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status,Duration(s)\n';

  fs.writeFileSync(validCloneLogPath, csvHeader, 'utf8');
  fs.writeFileSync(invalidCloneLogPath, csvHeader, 'utf8');
  fs.writeFileSync(validVersionDataLogPath, csvHeader, 'utf8');
  fs.writeFileSync(invalidVersionDataLogPath, csvHeader, 'utf8');

  if (mode === 'full' || mode === 'extract') {
    console.log(`[Extract] Loading dataset test_result.json...`);
    const data: Item[] = await LoadJson.item(CONFIG.TEST_RESULT_PATH);

    const libVersionRanges: TargetUpdate[] = extractUpdatesFromResults(data);
    console.log(`[Init] Extracted ${libVersionRanges.length} target version pairs from dataset.`);

    for (const task of libVersionRanges) {
      const taskStartTime = Date.now();
      const { libName, preVersion, postVersion } = task;

      const list1 = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(preVersion) && item.state.includes("success")).map(item => item.S__nameWithOwner);
      const list2Succ = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(postVersion) && item.state.includes("success")).map(item => item.S__nameWithOwner);
      const list2Fail = data.filter(item => item.L__nameWithOwner.includes(libName) && item.L__version.includes(postVersion) && item.state.includes("failure")).map(item => item.S__nameWithOwner);

      let clientsSucc = [...new Set(list2Succ.filter(value => list1.includes(value)))];
      let clientsFail = [...new Set(list2Fail.filter(value => list1.includes(value)))];

      if (clientsSucc.length === 0 || clientsFail.length === 0) {
        const taskDuration = (Date.now() - taskStartTime) / 1000;
        console.log(`\n[Skip] Task: ${libName} (${preVersion} -> ${postVersion}) - Not enough clients. [Done in ${taskDuration.toFixed(2)}s]`);

        appendCloneLog([invalidCloneLogPath, invalidVersionDataLogPath], libName, preVersion, postVersion, clientsSucc.length, clientsFail.length, 'EXCLUDED_NOT_ENOUGH_DATA', taskDuration);
        continue;
      }

      console.log(`\nStarting Full Task: ${libName} (${preVersion} -> ${postVersion})`);

      console.log(`--- Extracting success clients ---`);
      const historySucc = await ExtractVersion.extractVersion_all(clientsSucc, libName, postVersion, 'success');

      console.log(`--- Extracting failure clients ---`);
      const historyFail = await ExtractVersion.extractVersion_all(clientsFail, libName, postVersion, 'failure');

      const taskDuration = (Date.now() - taskStartTime) / 1000;

      if (historySucc.length > 0 && historyFail.length > 0) {
        console.log(`[Success] Valid clones found. Proceeding to save and analyze...`);
        await saveAndAnalyzeData(task, 'success', dateStr, mode, historySucc);
        await saveAndAnalyzeData(task, 'failure', dateStr, mode, historyFail);

        console.log(`[Completed] Task: ${libName} (${preVersion} -> ${postVersion}) [Done in ${taskDuration.toFixed(2)}s]`);

        appendCloneLog([validCloneLogPath, validVersionDataLogPath], libName, preVersion, postVersion, historySucc.length, historyFail.length, 'SUCCESS', taskDuration);
      } else {
        console.log(`[Exclude] One of the states returned 0 valid histories. Deleting cloned data...`);
        const cleanVersion = postVersion.replace(/[^a-zA-Z0-9]/g, '');
        const repoDir = path.resolve(process.cwd(), `../clientRepos_all/${libName}/${cleanVersion}`);

        if (fs.existsSync(repoDir)) {
          fs.rmSync(repoDir, { recursive: true, force: true });
        }

        console.log(`[Excluded] Task: ${libName} (${preVersion} -> ${postVersion}) [Done in ${taskDuration.toFixed(2)}s]`);

        appendCloneLog([invalidCloneLogPath, invalidVersionDataLogPath], libName, preVersion, postVersion, historySucc.length, historyFail.length, 'EXCLUDED_DUE_TO_ZERO_CLONE', taskDuration);
      }
    }
  } else if (mode === 'analyze') {
    const fakeTask = { libName: "dummy", preVersion: "1.0.0", postVersion: "2.0.0" };
    await saveAndAnalyzeData(fakeTask, 'success', dateStr, mode, [], CONFIG.ANALYZE_TARGET_HISTORY_PATH);
  }
})();