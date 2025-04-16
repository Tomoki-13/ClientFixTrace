import {_privateForTest} from '../module/create_version_pairs';

describe('create_version_pairs.ts test', () => {
    test('private judge_up_or_down', () => {
        let test_data: string[][] = [['1.0.0', '2.0.0'],['2.0.0', '1.0.0'],['1.0.0', '1.0.0'],['^1.0.0', '^2.0.0'],['^2.0.0', '^1.0.0']];
        let expectedOutput: string[] = ['update','downgrade','same','update','downgrade'];
        for(let i = 0; i < test_data.length; i++) {
            expect(_privateForTest.judge_up_or_down(test_data[i])).toEqual(expectedOutput[i]);
        }
    });

});