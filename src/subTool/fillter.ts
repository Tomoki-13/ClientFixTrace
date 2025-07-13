import * as fs from 'fs';
import { Client_Ver } from '../types/VersionCommits';
import * as path from 'path';
import output_json from '../utils/output_json';
import getMatchedClients from './moduleBox/getMatchedClients';
import { MatchClientPattern } from '../types/Item';
import { getAllFiles } from '../utils/getAllFiles';
import { getSubDir } from '../utils/getSubDir';
import { loadJsonData_Client_Ver } from '../utils/loadJson';


//バージョン名の抽出 ~~~/uuid-7.0.0-beta.0/~~~.json → 7.0.0-beta.0
function extractVersionName(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 2) return null;

  const secondLast = parts[parts.length - 2];
  const match = secondLast.match(/-(\d+\.\d+\.\d+(?:-[\w.]+)?)/);

  return match ? match[1] : null;
}

//特定バージョンを超えて更新したデータを週ちゅつ
async function fillter_isOverVersion() {
    let versionHistory_filePath:string[] = [];
    const alldirs: string[] = await getSubDir("");
    for(const subdir of alldirs) {
        let pathArray = await getAllFiles(subdir);
        versionHistory_filePath = versionHistory_filePath.concat(pathArray);
    }
    let libVersion:string[] = [];
    versionHistory_filePath.forEach(element => {
        libVersion.push(extractVersionName(element) || '0');
    });
    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

    for (let i = 0; i < versionHistory_filePath.length; i++) {
        let data:Client_Ver[] = loadJsonData_Client_Ver(versionHistory_filePath[i]);
        const parts = versionHistory_filePath[i].split('/');
        const result = parts.slice(-2, -1).join('/');
        const state_str = versionHistory_filePath[i].split('/').slice(-1)[0];

        //出力ファイルの区別のため
        let outDir = '';
        if(state_str.includes('success')){
            outDir = path.join('../../output/fillter/', date + '-success'+'/'+result);
        }else if(state_str.includes('failure')){
            outDir = path.join('../../output/fillter/', date + '-failure' + '/' + result);
        }else{
            outDir = path.join('../../output/fillter/',date + '/' + result);
        }
        
        if(libVersion[i] !== '0'){
            output_json.createOutputDirectory(outDir);
            const versionFiltered:Client_Ver[] = data.filter(item =>
                item.verList.some(ver => getMatchedClients.isVersionGreaterOrEqual(ver.version, libVersion[i]))
            );
            fs.writeFileSync(
                output_json.getUniqueOutputPath(outDir, libVersion[i] + 'update', versionFiltered.length.toString()+'-' + data.length), 
                JSON.stringify(versionFiltered, null, 2)
            );
        }
    } 
}

//別の結果に含まれるクライアントが，特定バージョンを超えて更新したかを検出
async function fillter_anotherData() {
    //MatchClientPattern[]
    const rawdata_filePath:string[] = JSON.parse(fs.readFileSync('', 'utf-8'));
    //Client_Ver[]
    let versionHistory_filePath:string[] = [];
    const alldirs: string[] = await getSubDir("");
    for(const subdir of alldirs) {
        let pathArray = await getAllFiles(subdir);
        versionHistory_filePath = versionHistory_filePath.concat(pathArray);
    }

    //ファイル単位の場合
    // const rawdata_filePath:string[] = [''];
    // let versionHistory_filePath:string[] = [''];

    let libVersion:string[] = [];
    versionHistory_filePath.forEach(element => {
        libVersion.push(extractVersionName(element) || '0');
    });

    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    for (let i = 0; i < rawdata_filePath.length; i++) {
        let matched:Client_Ver[] = getMatchedClients.getMatchedClients(rawdata_filePath[i], versionHistory_filePath[i]);

        const parts = versionHistory_filePath[i].split('/');
        const result = parts.slice(-2, -1).join('/');
        const state_str = versionHistory_filePath[i].split('/').slice(-1)[0];

        //出力ファイルの区別のため
        let outDir = '';
        if(state_str.includes('success')){
            outDir = path.join('../../output/fillter/', date + '-success'+'/'+result);
        }else if(state_str.includes('failure')){
            outDir = path.join('../../output/fillter/', date + '-failure' + '/' + result);
        }else{
            outDir = path.join('../../output/fillter/',date + '/' + result);
        }

        output_json.createOutputDirectory(outDir);
        //別データに該当するどのクライアントが単にバージョンを更新したか
        fs.writeFileSync(
            output_json.getUniqueOutputPath(outDir, 'update', matched.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(fs.readFileSync(rawdata_filePath[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
            JSON.stringify(matched, null, 2)
        );

        if(libVersion[i] !== '0'){
            const versionFiltered:Client_Ver[] = matched.filter(item =>
                item.verList.some(ver => getMatchedClients.isVersionGreaterOrEqual(ver.version, libVersion[i]))
            );
            //別データに該当するどのクライアントが"特定"のバージョンに更新したか
            fs.writeFileSync(
                output_json.getUniqueOutputPath(outDir, libVersion[i] + 'update', versionFiltered.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(fs.readFileSync(rawdata_filePath[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
                JSON.stringify(versionFiltered, null, 2)
            );
        }
    } 
}
fillter_isOverVersion()
// fillter_anotherData();