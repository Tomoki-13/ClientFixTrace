import * as fs from 'fs';
import { Client_Ver } from '../types/VersionCommits';
import * as path from 'path';
import output_json from '../utils/output_json';
import getMatchedClients from './moduleBox/getMatchedClients';
import { MatchClientPattern } from '../types/Item';
import { getAllFiles } from '../utils/getAllFiles';
import { getSubDir } from '../utils/getSubDir';

async function main() {
    //入力　MatchClientPattern[]
    const rawdata_filePath:string[] = JSON.parse(fs.readFileSync('../../datasets/mydata/matchResult.JSON', 'utf-8'));
    //Client_Ver[]
    let versionHistory_filePath:string[] = [];
    const alldirs: string[] = await getSubDir("../../output/versionData/2025-07-08-19-25-31");
    for(const subdir of alldirs) {
        let pathArray = await getAllFiles(subdir);
        versionHistory_filePath = versionHistory_filePath.concat(pathArray);
    }
    console.log(versionHistory_filePath);

    //ファイル単位の場合
    // const rawdata_filePath:string[] =
    // let versionHistory_filePath:string[] = [];

    let libVersion:string[] = [];
    versionHistory_filePath.forEach(element => {
        const parts = element.split('/');
        libVersion.push(parts.at(-2) || '');
    });

    const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    for (let i = 0; i < rawdata_filePath.length; i++) {
        let matched:Client_Ver[] = getMatchedClients.getMatchedClients(rawdata_filePath[i], versionHistory_filePath[i]);

        const parts = versionHistory_filePath[i].split('/');
        const result = parts.slice(-3, -1).join('/');
        let outDir = path.join('../../output/fillter/',date+'/'+result);
        output_json.createOutputDirectory(outDir);
        
        fs.writeFileSync(
            output_json.getUniqueOutputPath(outDir, 'update', matched.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(fs.readFileSync(rawdata_filePath[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
            JSON.stringify(matched, null, 2)
        );

        const versionFiltered:Client_Ver[] = matched.filter(item =>
            item.verList.some(ver => getMatchedClients.isVersionGreaterOrEqual(ver.version, libVersion[i]))
        );


        fs.writeFileSync(
            output_json.getUniqueOutputPath(outDir, libVersion[i] + 'update', versionFiltered.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(fs.readFileSync(rawdata_filePath[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
            JSON.stringify(versionFiltered, null, 2)
        );
    } 
}

main();