import CreateVersionPairs from '../core/create_version_pairs';
import { VersionPair } from '../types/VersionPair';
import { Client_Ver } from '../types/VersionCommits';
import LoadJson from '../utils/loadJson';
import ArrayOperation from '../utils/arrayOperation';

describe('create_version_pairs.ts test', () => {
    const filepath:string = './src/__tests__/inputFiles/sample/data.json';
    
    // mode = 0　クライアント内での重複を許容
    test('create_version_pairs(mode = 0)', () => {
        const data: Client_Ver[] = LoadJson.clientVer(filepath);
        let inputdata: string[][] = ArrayOperation.extractVersionList(data);

        const expectedOutput: VersionPair[] = [
                { type: 'update', from: '^6.0.0', to: '^6.1.0', count: 1 },
                { type: 'update', from: '^6.1.0', to: '^8.0.0', count: 1 },
                { type: 'update', from: '^8.0.0', to: '^11.0.0', count: 2 },
                { type: 'downgrade', from: '^11.0.0', to: '^8.0.0', count: 1 }
        ];
        expect(CreateVersionPairs.create_version_pairs(inputdata, 'libname', 0)).toEqual(expectedOutput);
    });
    
    // mode = 1　クライアント内での重複を削除
    test('create_version_pairs(mode = 1)', () => {
        const data: Client_Ver[] = LoadJson.clientVer(filepath);
        let inputdata: string[][] = ArrayOperation.extractVersionList(data);

        const expectedOutput: VersionPair[] = [
                { type: 'update', from: '^6.0.0', to: '^6.1.0', count: 1 },
                { type: 'update', from: '^6.1.0', to: '^8.0.0', count: 1 },
                { type: 'update', from: '^8.0.0', to: '^11.0.0', count: 1 },
                { type: 'downgrade', from: '^11.0.0', to: '^8.0.0', count: 1 }
        ];
        expect(CreateVersionPairs.create_version_pairs(inputdata, 'libname', 1)).toEqual(expectedOutput);
    });
});