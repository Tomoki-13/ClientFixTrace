import fs from 'fs';
import ParseCloneSummary from '../utils/cloneSummary';

// fsモジュールをモック化
jest.mock('fs');

describe('parseCloneSummary.ts test', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('CSVからSUCCESSのタスクのみを抽出できること', () => {
    const mockCsvContent = `Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status,Duration(s)
      uuid,8.0.0,9.0.0,2,2,SUCCESS,10.5
      globby,10.0.0,11.0.0,0,0,EXCLUDED_NOT_ENOUGH_DATA,1.2
      big.js,5.0.0,6.0.0,1,1,SUCCESS,8.0`;

    // fs.readFileSync が呼ばれたときにモックのCSV文字列を返すように設定
    (fs.readFileSync as jest.Mock).mockReturnValue(mockCsvContent);

    const result = ParseCloneSummary.parse('dummy_path.csv');

    // SUCCESSの2件だけが抽出されているはず
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { libName: 'uuid', preVersion: '8.0.0', postVersion: '9.0.0' },
      { libName: 'big.js', preVersion: '5.0.0', postVersion: '6.0.0' }
    ]);
  });

  test('空のCSVやヘッダーのみの場合は空配列を返すこと', () => {
    const mockCsvContent = `Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status,Duration(s)\n`;
    (fs.readFileSync as jest.Mock).mockReturnValue(mockCsvContent);

    const result = ParseCloneSummary.parse('dummy_path.csv');
    expect(result).toEqual([]);
  });
});