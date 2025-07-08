import {create_version_pairs} from '../core/create_version_pairs';
import { VersionPair } from '../types/VersionPair';
import { Client_Ver } from '../types/VersionCommits';
import { loadJsonData_Client_Ver } from '../utils/loadJson';
import { extractVersionList } from '../utils/arrayOperation';

describe('create_version_pairs.ts test', () => {
    const filepath:string = './src/__tests__/inputFiles/sample/data.json';
    //mode = 0　クライアント内での重複を許容
    test('create_version_pairs(mode = 0)', () => {
        const data:Client_Ver[] = loadJsonData_Client_Ver(filepath);
        let inputdata:string[][] = extractVersionList(data);

        const expectedOutput: VersionPair[] = [
                { type: 'update', from: '^6.0.0', to: '^6.1.0', count: 1 },
                { type: 'update', from: '^6.1.0', to: '^8.0.0', count: 1 },
                { type: 'update', from: '^8.0.0', to: '^11.0.0', count: 2 },
                { type: 'downgrade', from: '^11.0.0', to: '^8.0.0', count: 1 }
        ];
        expect(create_version_pairs(inputdata,'libname',0)).toEqual(expectedOutput);
    });
    //mode = 1　クライアント内での重複を削除
    test('create_version_pairs(mode = 1)', () => {
        const data:Client_Ver[] = loadJsonData_Client_Ver(filepath);
        let inputdata:string[][] = extractVersionList(data);

        const expectedOutput: VersionPair[] = [
                { type: 'update', from: '^6.0.0', to: '^6.1.0', count: 1 },
                { type: 'update', from: '^6.1.0', to: '^8.0.0', count: 1 },
                { type: 'update', from: '^8.0.0', to: '^11.0.0', count: 1 },
                { type: 'downgrade', from: '^11.0.0', to: '^8.0.0', count: 1 }
        ];
        expect(create_version_pairs(inputdata,'libname',1)).toEqual(expectedOutput);
    });
});