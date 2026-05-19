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