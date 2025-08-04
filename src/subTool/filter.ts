import * as fs from 'fs/promises';
import { Client_Ver,specificCommit } from '../types/VersionCommits';
import * as path from 'path';
import output_json from '../utils/output_json';
import getMatchedClients from './moduleBox/getMatchedClients';
import { MatchClientPattern } from '../types/Item';
import { get_specificVer_commit } from './moduleBox/get_specificVer_commit';
import { getAllFilesRecursively } from '../utils/getAllFiles';
import { loadJsonData_Client_Ver } from '../utils/loadJson';

type LibAndVersion = {
    libName: string;
    version: string;
};
//バージョン名の抽出 ~~~/libname-0.0.0-beta.0/~~~.json → 0.0.0-beta.0
function extractLibAndVersion(path: string): LibAndVersion | null {
    const parts = path.split('/');
    if (parts.length < 2) return null;
    const dirName = parts[parts.length - 2].trim();
    const match = dirName.match(/^(.+)-(\d+\.\d+\.\d+(?:-[\w.]+)?)$/);
    if (!match) return null;
    const [, rawLibName, rawVersion] = match;
    const libName = rawLibName.trim();
    const version = rawVersion.trim();
    return { libName, version };
}

/**
 * 関数の説明：特定バージョンを超えて更新したデータを抽出
 * matchdata_pathを入力する場合2つの入力のファイルの対応関係に注意
 * @param {string} verHist_path - cloneAndextractOnly.tsの出力を指定 ~~~/dateを指定
 * @param {string} matchdata_path - matchdata_pathがある場合に処理分岐　
 */
async function filter_isOverVersion(verHist_path:string,matchdata_path:string = '') {
    const results: string[] = [];
    const stats = await fs.stat(verHist_path);
    let versionHistory_filePath:string[] = [];
    let libInfo:LibAndVersion[] = []
    
    if (stats.isFile()) {
        versionHistory_filePath = JSON.parse(await fs.readFile(path.resolve(__dirname, verHist_path), 'utf-8'));
    }else if (stats.isDirectory()) {
        versionHistory_filePath = await getAllFilesRecursively(verHist_path);
    }
    versionHistory_filePath.forEach(element => {
        let libNameAndVersion:LibAndVersion|null = extractLibAndVersion(element);
        if (libNameAndVersion === null) {
            console.warn(`Invalid path format: ${element}`);
        } else {
            libInfo.push(libNameAndVersion);
        }
    });
    console.log('versionHistory_filePath:',versionHistory_filePath);
    console.log('matchdata_path:',JSON.parse(await fs.readFile(path.resolve(__dirname, matchdata_path), 'utf-8')));
    
    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    for (let i = 0; i < versionHistory_filePath.length; i++) {
        let data:Client_Ver[] = loadJsonData_Client_Ver(versionHistory_filePath[i]);
        const parts = versionHistory_filePath[i].split('/');
        const ver = parts.slice(-2, -1).join('/');
        const state_str = parts.slice(-1)[0];

        //出力ファイルの区別のため
        let outDir = '';
        if(state_str.includes('success')){
            outDir = path.join('../../output/filter/', date + '-success'+'/'+ver);
        }else if(state_str.includes('failure')){
            outDir = path.join('../../output/filter/', date + '-failure' + '/' + ver);
        }else{
            outDir = path.join('../../output/filter/',date + '/' + ver);
        }
        output_json.createOutputDirectory(outDir);

        //フィルタリングの処理
        if(libInfo[i].version !== '0' && matchdata_path === ''){ //全てのデータを対象に特定バージョンを超えたクライアントを取得
            const versionFiltered:Client_Ver[] = data.filter(item =>
                item.verList.some(ver => getMatchedClients.isVersionGreaterOrEqual(ver.version, libInfo[i].version))
            );
            await fs.writeFile(
                output_json.getUniqueOutputPath(outDir, libInfo[i].version + 'update', versionFiltered.length.toString()+'-' + data.length), 
                JSON.stringify(versionFiltered, null, 2)
            );
        } else if (libInfo[i].version !== '0' && matchdata_path !== '') {//matchdata_pathに含まれるデータで特定バージョンを超えたクライアントを取得
            const matchedData_filePath:string[] = JSON.parse(await fs.readFile(path.resolve(__dirname, matchdata_path), 'utf-8'));
            let specificVersion_data:Client_Ver[] = getMatchedClients.getMatchedClients(matchedData_filePath[i], versionHistory_filePath[i]);
            await fs.writeFile(
                output_json.getUniqueOutputPath(outDir, libInfo[i].libName+libInfo[i].version + 'update', 
                    specificVersion_data.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(await fs.readFile(matchedData_filePath[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
                JSON.stringify(specificVersion_data, null, 2)
            );
            
            const versionFiltered:Client_Ver[] = specificVersion_data.filter(item =>
                item.verList.some(ver => getMatchedClients.isVersionGreaterOrEqual(ver.version, libInfo[i].version))
            );
            const commit_data: specificCommit[] = get_specificVer_commit(versionFiltered, libInfo[i].version);
            //別データに該当するどのクライアントが"特定"のバージョンに更新したか
            await fs.writeFile(
                output_json.getUniqueOutputPath(outDir,libInfo[i].libName+libInfo[i].version + 'update', versionFiltered.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(await fs.readFile(matchedData_filePath[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
                JSON.stringify(versionFiltered, null, 2)
            );

            //コミットデータは，別のディレクトリに保存
            outDir = path.dirname(outDir) + '/specificCommit'
            output_json.createOutputDirectory(outDir);
            await fs.writeFile(
                output_json.getUniqueOutputPath(outDir,libInfo[i].libName+libInfo[i].version, 'update'), 
                JSON.stringify(commit_data, null, 2)
            );
        }else{
            console.warn('バージョンが0のデータが存在します。');
            return [];
        }
    }
}

(async () => {
    // await filter_isOverVersion('../../output/versionData/2025-07-24-19-35-24','../../datasets/mydata/filter/matchResult.json');
    await filter_isOverVersion('../../datasets/mydata/filter/verHist_success.json','../../datasets/mydata/filter/matchResult.json');
})();