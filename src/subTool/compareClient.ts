import * as fs from 'fs';
import { loadJsonData_Client_Ver } from '../utils/loadJson';
import { MatchClientPattern } from '../types/Item';
import { Client_Ver } from '../types/VersionCommits';
import * as path from 'path';
import output_json from '../utils/output_json';

function main() {
    let baseVersion = '';
    const rawdata_filePath1 = '';
    const version_filePath2 = '';

    // client 一覧の取得
    let rawData: MatchClientPattern[] = JSON.parse(fs.readFileSync(rawdata_filePath1, 'utf-8')) as MatchClientPattern[];
    let clientList_detected: string[] = extractClients(rawData);
    const trimmedClients = clientList_detected.map(path => {
    const parts = path.split('/');return parts.slice(-2).join('/');});
    console.log("Trimmed Clients:", trimmedClients);


    let verHistory: Client_Ver[] = loadJsonData_Client_Ver(version_filePath2);
    const matched = verHistory.filter(item =>
        trimmedClients.some(trimmed => item.client.includes(trimmed))
    );

    // // 結果出力
    // console.log("Matched verHistory items:", matched);
    const versionFiltered = matched.filter(item =>
        item.verList.some(ver => isVersionGreaterOrEqual(ver.version, baseVersion))
    );

    console.log("versionFiltered:", JSON.stringify(versionFiltered),null,2);
    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    let outDir = path.join('../../output/updateData', path.basename(version_filePath2).split('.')[0] + date);
    output_json.createOutputDirectory(outDir);

    fs.writeFileSync(output_json.getUniqueOutputPath(outDir, 'update', 'client'+versionFiltered.length), 
        JSON.stringify(versionFiltered, null, 2));
}

// client一覧をstring[]として取得する関数
function extractClients(data: MatchClientPattern[]): string[] {
  return data.map(item => item.client).filter((client): client is string => typeof client === 'string');
}


// バージョンを比較する関数　baseの上or下or等しいかを判定
function isVersionGreaterOrEqual(v: string, base: string): boolean {
    const vParts = v.split('.').map(Number);
    const baseParts = base.split('.').map(Number);
    
    for(let i = 0; i < Math.max(vParts.length, baseParts.length); i++) {
        const vNum = vParts[i] || 0;
        const baseNum = baseParts[i] || 0;
        if(vNum > baseNum) return true;
        if(vNum < baseNum) return false;
    }
    return true; // 完全に等しいとき
}

main();