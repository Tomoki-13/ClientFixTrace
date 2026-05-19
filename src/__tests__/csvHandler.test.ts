import fs from 'fs';
import CsvHandler from '../utils/csvHandler';

jest.mock('fs');

const mockFs = fs as jest.Mocked<typeof fs>;

afterEach(() => jest.clearAllMocks());

describe('loadCloneSummary()', () => {
  test('ファイルが存在しない場合は空配列を返す', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(CsvHandler.loadCloneSummary('dummy.csv')).toEqual([]);
  });

  test('正常なCSVをパースして TargetUpdate[] を返す', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status\n' +
      'acorn,0.6.0,0.7.0,3,2,TARGET_ACCEPTED\n' +
      'uuid,8.0.0,9.0.0,1,0,TARGET_ACCEPTED'
    );
    const result = CsvHandler.loadCloneSummary('dummy.csv');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      libName: 'acorn', preVersion: '0.6.0', postVersion: '0.7.0',
      SuccessCloned: 3, FailureCloned: 2, Status: 'TARGET_ACCEPTED'
    });
  });

  test('列数が足りない行はスキップする', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status\n' +
      'acorn,0.6.0\n' +
      'uuid,8.0.0,9.0.0,1,0,TARGET_ACCEPTED'
    );
    const result = CsvHandler.loadCloneSummary('dummy.csv');
    expect(result).toHaveLength(1);
    expect(result[0].libName).toBe('uuid');
  });

  test('ヘッダーのみの場合は空配列を返す', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(
      'Library,PreVersion,PostVersion,SuccessCloned,FailureCloned,Status\n'
    );
    expect(CsvHandler.loadCloneSummary('dummy.csv')).toEqual([]);
  });
});
