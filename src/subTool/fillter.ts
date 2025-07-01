import * as fs from 'fs';
import { Client_Ver } from '../types/VersionCommits';
import * as path from 'path';
import output_json from '../utils/output_json';
import getMatchedClients from './moduleBox/getMatchedClients';
import { MatchClientPattern } from '../types/Item';

function main() {
    //入力
    const rawdata_filePath1:string[] = [

    ];
    const version_filePath2:string[] = [

    ];


    let libVersion:string[] = [];
    version_filePath2.forEach(element => {
        const parts = element.split('/');
        libVersion.push(parts.at(-2) || '');
    });
    console.log("libVersion:", libVersion);

    for (let i = 0; i < rawdata_filePath1.length; i++) {
        let matched:Client_Ver[] = getMatchedClients.getMatchedClients(rawdata_filePath1[i], version_filePath2[i]);

        const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
        const parts = version_filePath2[i].split('/');
        const result = parts.slice(-3, -1).join('/');
        let outDir = path.join('../../output/fillter/',date+'/'+result);
        output_json.createOutputDirectory(outDir);
        
        fs.writeFileSync(
            output_json.getUniqueOutputPath(outDir, 'update', matched.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(fs.readFileSync(rawdata_filePath1[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
            JSON.stringify(matched, null, 2)
        );

        const versionFiltered:Client_Ver[] = matched.filter(item =>
            item.verList.some(ver => getMatchedClients.isVersionGreaterOrEqual(ver.version, libVersion[i]))
        );


        fs.writeFileSync(
            output_json.getUniqueOutputPath(outDir, libVersion[i] + 'update', versionFiltered.length.toString()+'-'+getMatchedClients.extractClients(JSON.parse(fs.readFileSync(rawdata_filePath1[i], 'utf-8')) as MatchClientPattern[]).length.toString()), 
            JSON.stringify(versionFiltered, null, 2)
        );
    } 
}

main();