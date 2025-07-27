import * as fs from 'fs/promises';
import { Client_Ver } from '../types/VersionCommits';
import * as path from 'path';
import output_json from '../utils/output_json';
import getMatchedClients from './moduleBox/getMatchedClients';
import { MatchClientPattern } from '../types/Item';
import { getAllFiles } from '../utils/getAllFiles';
import { getSubDir } from '../utils/getSubDir';
import { loadJsonData_Client_Ver } from '../utils/loadJson';

//バージョン名の抽出 ~~~/libname-0.0.0-beta.0/~~~.json → 0.0.0-beta.0
function extractVersionName(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 2) return null;

  const secondLast = parts[parts.length - 2];
  const match = secondLast.match(/-(\d+\.\d+\.\d+(?:-[\w.]+)?)/);

  return match ? match[1] : null;
}

//再帰的に全てのファイルを取得する関数
//targetPath: stringはdirectoryまたはfileのパス
async function getAllFilesRecursively(targetPath: string): Promise<string[]> {
    // パスがファイルかディレクトリかを判定
    const stats = await fs.stat(targetPath);
    if (stats.isFile()) {
        return [targetPath];
    }
    if (stats.isDirectory()) {
        let files: string[] = [];
        const alldirs: string[] = await getSubDir(targetPath);
        for(const subdir of alldirs) {
            let pathArray = await getAllFiles(subdir);
            files = files.concat(pathArray);
        }
        return files;
    }
    return [];
}

/**
 * 関数の説明：定バージョンを超えて更新したデータを抽出
 * @param {string} verHist_path - cloneAndextractOnly.tsの出力を指定
 * @param {string} matchdata_path - matchdata_pathがある場合に処理分岐
 */
async function filter_isOverVersion(verHist_path:string,matchdata_path:string = '') {
    const versionHistory_filePath = await getAllFilesRecursively(verHist_path);
    let libVersion:string[] = [];
    versionHistory_filePath.forEach(element => {
        libVersion.push(extractVersionName(element) || '0');
    });

    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    for (let i = 0; i < versionHistory_filePath.length; i++) {
        let data:Client_Ver[] = loadJsonData_Client_Ver(versionHistory_filePath[i]);
        const parts = versionHistory_filePath[i].split('/');
        const result = parts.slice(-2, -1).join('/');
        const state_str = parts.slice(-1)[0];

        //出力ファイルの区別のため
        let outDir = '';
        if(state_str.includes('success')){
            outDir = path.join('../../output/filter/', date + '-success'+'/'+result);
        }else if(state_str.includes('failure')){
            outDir = path.join('../../output/filter/', date + '-failure' + '/' + result);
        }else{
            outDir = path.join('../../output/filter/',date + '/' + result);
        }
        output_json.createOutputDirectory(outDir);

        //フィルタリングの処理
        if(libVersion[i] !== '0' && matchdata_path !== ''){ //全てのデータを対象に特定バージョンを超えたクライアントを取得
            const versionFiltered:Client_Ver[] = data.filter(item =>
                item.verList.some(ver => getMatchedClients.isVersionGreaterOrEqual(ver.version, libVersion[i]))
            );
            await fs.writeFile(
                output_json.getUniqueOutputPath(outDir, libVersion[i] + 'update', versionFiltered.length.toString()+'-' + data.length), 
                JSON.stringify(versionFiltered, null, 2)
            );
        }else if (matchdata_path !== '') {
            const matchedData_filePath:string[] = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../datasets/mydata/filter/matchResult.json'), 'utf-8'));
            let specificVersion_data:Client_Ver[] = getMatchedClients.getMatchedClients(matchedData_filePath[i], versionHistory_filePath[i]);
            await fs.writeFile(
                output_json.getUniqueOutputPath(outDir, libVersion[i] + 'update', 
                    specificVersion_data.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(await fs.readFile(matchedData_filePath[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
                JSON.stringify(specificVersion_data, null, 2)
            );
        } else if (libVersion[i] !== '0' && matchdata_path !== '') {
            const matchedData_filePath:string[] = JSON.parse(await fs.readFile(path.resolve(__dirname, '../../datasets/mydata/filter/matchResult.json'), 'utf-8'));
            let specificVersion_data:Client_Ver[] = getMatchedClients.getMatchedClients(matchedData_filePath[i], versionHistory_filePath[i]);
            await fs.writeFile(
                output_json.getUniqueOutputPath(outDir, libVersion[i] + 'update', 
                    specificVersion_data.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(await fs.readFile(matchedData_filePath[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
                JSON.stringify(specificVersion_data, null, 2)
            );
            const versionFiltered:Client_Ver[] = specificVersion_data.filter(item =>
                item.verList.some(ver => getMatchedClients.isVersionGreaterOrEqual(ver.version, libVersion[i]))
            );
            //別データに該当するどのクライアントが"特定"のバージョンに更新したか
            await fs.writeFile(
                output_json.getUniqueOutputPath(outDir,libVersion[i] + 'update', versionFiltered.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(await fs.readFile(matchedData_filePath[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
                JSON.stringify(versionFiltered, null, 2)
            );
        } 
    }
}
(async () => {
    await filter_isOverVersion('','');
})();