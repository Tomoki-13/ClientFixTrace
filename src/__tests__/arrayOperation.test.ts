import CompareVersion from '../utils/compareVersion';

describe('cleanVersion', () => {
    test('should clean standard version strings', () => {
        expect(CompareVersion.clean('1.2.3')).toEqual([1, 2, 3]);
    });

    test('should remove prefixes like ^, ~, =, <, >', () => {
        expect(CompareVersion.clean('^4.5.6')).toEqual([4, 5, 6]);
        expect(CompareVersion.clean('~7.8.9')).toEqual([7, 8, 9]);
        expect(CompareVersion.clean('>=1.0.0')).toEqual([1, 0, 0]);
    });

    test('should remove pre-release tags', () => {
        expect(CompareVersion.clean('1.0.0-alpha.1')).toEqual([1, 0, 0]);
        expect(CompareVersion.clean('2.3.4-beta')).toEqual([2, 3, 4]);
    });

    test('should handle leading spaces', () => {
        expect(CompareVersion.clean(' 2.3.4')).toEqual([2, 3, 4]);
    });
});

describe('create_version_pairs.ts test', () => {
    // --- Update Cases ---
    test('should return "update" for major version increase', () => {
        expect(CompareVersion.judgeUpOrDown(['1.5.0', '2.0.0'])).toBe('update');
    });
    test('should return "update" for minor version increase', () => {
        expect(CompareVersion.judgeUpOrDown(['1.5.0', '1.6.0'])).toBe('update');
    });
    test('should return "update" for patch version increase', () => {
        expect(CompareVersion.judgeUpOrDown(['1.5.0', '1.5.1'])).toBe('update');
    });

    // --- Downgrade Cases ---
    test('should return "downgrade" for major version decrease', () => {
        expect(CompareVersion.judgeUpOrDown(['2.0.0', '1.8.8'])).toBe('downgrade');
    });
    test('should return "downgrade" for minor version decrease', () => {
        expect(CompareVersion.judgeUpOrDown(['1.6.0', '1.5.5'])).toBe('downgrade');
    });
    test('should return "downgrade" for patch version decrease', () => {
        expect(CompareVersion.judgeUpOrDown(['1.5.1', '1.5.0'])).toBe('downgrade');
    });

    // --- Same Cases ---
    test('should return "same" for identical versions', () => {
        expect(CompareVersion.judgeUpOrDown(['1.2.3', '1.2.3'])).toBe('same');
    });

    test('should return "same" for identical versions with different prefixes', () => {
        expect(CompareVersion.judgeUpOrDown(['^1.2.3', '~1.2.3'])).toBe('same');
    });

    test('basic case', () => {
        let test_data: string[][] = [['1.0.0', '2.0.0'],['2.0.0', '1.0.0'],['1.0.0', '1.0.0'],['^1.0.0', '^2.0.0'],['^2.0.0', '^1.0.0']];
        let expectedOutput: string[] = ['update','downgrade','same','update','downgrade'];
        for(let i = 0; i < test_data.length; i++) {
            expect(CompareVersion.judgeUpOrDown(test_data[i])).toEqual(expectedOutput[i]);
        }
    });
});