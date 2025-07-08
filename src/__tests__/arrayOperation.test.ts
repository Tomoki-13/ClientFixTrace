import { compareVersions,cleanVersion,judge_up_or_down, } from '../utils/compareVersion';

describe('cleanVersion', () => {
    test('should clean standard version strings', () => {
        expect(cleanVersion('1.2.3')).toEqual([1, 2, 3]);
    });

    test('should remove prefixes like ^, ~, =, <, >', () => {
        expect(cleanVersion('^4.5.6')).toEqual([4, 5, 6]);
        expect(cleanVersion('~7.8.9')).toEqual([7, 8, 9]);
        expect(cleanVersion('>=1.0.0')).toEqual([1, 0, 0]);
    });

    test('should remove pre-release tags', () => {
        expect(cleanVersion('1.0.0-alpha.1')).toEqual([1, 0, 0]);
        expect(cleanVersion('2.3.4-beta')).toEqual([2, 3, 4]);
    });

    test('should handle leading spaces', () => {
        expect(cleanVersion(' 2.3.4')).toEqual([2, 3, 4]);
    });
});

describe('create_version_pairs.ts test', () => {
        // --- Update Cases ---
    test('should return "update" for major version increase', () => {
        expect(judge_up_or_down(['1.5.0', '2.0.0'])).toBe('update');
    });
    test('should return "update" for minor version increase', () => {
        expect(judge_up_or_down(['1.5.0', '1.6.0'])).toBe('update');
    });
    test('should return "update" for patch version increase', () => {
        expect(judge_up_or_down(['1.5.0', '1.5.1'])).toBe('update');
    });

    // --- Downgrade Cases ---
    test('should return "downgrade" for major version decrease', () => {
        expect(judge_up_or_down(['2.0.0', '1.8.8'])).toBe('downgrade');
    });
    test('should return "downgrade" for minor version decrease', () => {
        expect(judge_up_or_down(['1.6.0', '1.5.5'])).toBe('downgrade');
    });
    test('should return "downgrade" for patch version decrease', () => {
        expect(judge_up_or_down(['1.5.1', '1.5.0'])).toBe('downgrade');
    });

    // --- Same Cases ---
    test('should return "same" for identical versions', () => {
        expect(judge_up_or_down(['1.2.3', '1.2.3'])).toBe('same');
    });

    test('should return "same" for identical versions with different prefixes', () => {
        expect(judge_up_or_down(['^1.2.3', '~1.2.3'])).toBe('same');
    });

    test('basic case', () => {
        let test_data: string[][] = [['1.0.0', '2.0.0'],['2.0.0', '1.0.0'],['1.0.0', '1.0.0'],['^1.0.0', '^2.0.0'],['^2.0.0', '^1.0.0']];
        let expectedOutput: string[] = ['update','downgrade','same','update','downgrade'];
        for(let i = 0; i < test_data.length; i++) {
            expect(judge_up_or_down(test_data[i])).toEqual(expectedOutput[i]);
        }
    });
});
