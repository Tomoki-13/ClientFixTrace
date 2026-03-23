import { MatchClientPattern } from '../types/Item';
import GetMatchedClients from '../utils/getMatchedClients';

describe('getMatchedClients', () => {
    test('getMatchedClients', () => {
        // 関数名変更 getMatchedClients -> get
        const Output = GetMatchedClients.get(
            './src/__tests__/inputFiles/getMatchedClients_data/detected_clients.json', 
            './src/__tests__/inputFiles/getMatchedClients_data/all_versions.json'
        );
        let expectedOutput = [
            {
                "client": "vendor/client-A",
                "verList": [{ "ver": "1.0.0", "commit": "abc" }]
            },
            {
                "client": "vendor/client-C",
                "verList": [{ "ver": "3.5.2", "commit": "ghi" }]
            }
        ]
        expect(Output).toEqual(expectedOutput);
    });

    describe('isVersionGreaterOrEqual', () => {
        test.each([
            ['1.10.0', '1.2.0', true],
            ['2.0', '1.9.9', true],
            ['1.2.3', '1.2.3', true],
            ['1.2', '1.2.0', true],
            ['1.2.0', '1.2.1', false],
            ['1.1.9', '1.2.0', false],
        ])('ver >= base', (ver, base, expected) => {
            const output = GetMatchedClients.isVersionGreaterOrEqual(ver, base);
            expect(output).toBe(expected);
        });
    });

    describe('extractClients', () => {
        it('should extract client list', () => {
            // Arrange
            const inputData: MatchClientPattern[] = [
                { client: "full/path/to/vendor/client-A", pattern: [], detectPattern: [] },
                { client: "another/path/vendor/client-B", pattern: [], detectPattern: [] }
            ];
            const expectedOutput = ["vendor/client-A", "vendor/client-B"];
            
            // 関数名変更 extractClients -> extract
            const output = GetMatchedClients.extract(inputData);
            expect(output).toEqual(expectedOutput);
        });
    });
});