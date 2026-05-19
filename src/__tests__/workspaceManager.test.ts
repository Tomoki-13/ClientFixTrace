import fs from 'fs';
import WorkspaceManager from '../utils/workspaceManager';

jest.mock('fs');

const mockFs = fs as jest.Mocked<typeof fs>;

afterEach(() => jest.clearAllMocks());

// ----------------------------------------------------------------
// resolveSourcePath
// ----------------------------------------------------------------
describe('resolveSourcePath()', () => {
  test('sourceReposRoot 配下にリポジトリが存在する場合はそのパスを返す', () => {
    mockFs.existsSync.mockReturnValueOnce(true);
    const result = WorkspaceManager.resolveSourcePath('/repos', 'acorn', 'user/repo');
    expect(result).not.toBeNull();
    expect(result).toContain('acorn');
    expect(result).not.toContain('temp');
  });

  test('sourceReposRoot になく temp/master にある場合はフォールバックパスを返す', () => {
    mockFs.existsSync
      .mockReturnValueOnce(false)  // sourceReposRoot → なし
      .mockReturnValueOnce(true);  // temp/master → あり
    const result = WorkspaceManager.resolveSourcePath('/repos', 'acorn', 'user/repo');
    expect(result).not.toBeNull();
    expect(result).toContain('temp');
    expect(result).toContain('master');
  });

  test('どちらにも存在しない場合は null を返す', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(WorkspaceManager.resolveSourcePath('/repos', 'acorn', 'user/repo')).toBeNull();
  });
});

// ----------------------------------------------------------------
// loadPatterns
// ----------------------------------------------------------------

const flatPattern = [
  [
    [{ FunctionCallCode: 'require("acorn")', filePath: '', line: 0, argTypes: [], argContexts: [] }]
  ]
];

describe('loadPatterns()', () => {
  describe('mode 0 — detectpatternlist.json 優先', () => {
    test('detectpatternlist.json が存在すればそれを使う', () => {
      const files = [
        '/rbc/failure_detectpatternlist.json',
        '/rbc/failure_patternList.json',
      ];
      mockFs.readFileSync.mockReturnValue(JSON.stringify(flatPattern));
      WorkspaceManager.loadPatterns(files, 0);
      const usedFile = (mockFs.readFileSync as jest.Mock).mock.calls[0][0] as string;
      expect(usedFile).toContain('detectpatternlist.json');
    });

    test('detectpatternlist.json がなければ patternList.json にフォールバックする', () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify(flatPattern));
      const result = WorkspaceManager.loadPatterns(['/rbc/failure_patternList.json'], 0);
      expect(result).not.toBeNull();
    });

    test('対応ファイルが一切ない場合は null を返す', () => {
      expect(WorkspaceManager.loadPatterns(['/rbc/other.json'], 0)).toBeNull();
    });
  });

  describe('mode 1/2 — patternList.json のみ使用', () => {
    test('patternList.json を使い detectpatternlist.json は無視する', () => {
      const files = [
        '/rbc/failure_detectpatternlist.json',
        '/rbc/failure_patternList.json',
      ];
      mockFs.readFileSync.mockReturnValue(JSON.stringify(flatPattern));
      WorkspaceManager.loadPatterns(files, 1);
      const usedFile = (mockFs.readFileSync as jest.Mock).mock.calls[0][0] as string;
      expect(usedFile).toContain('patternList.json');
      expect(usedFile).not.toContain('detectpatternlist.json');
    });

    test('detectpatternlist.json しかない場合は null を返す', () => {
      expect(WorkspaceManager.loadPatterns(['/rbc/failure_detectpatternlist.json'], 1)).toBeNull();
    });

    test('mode 2 でも patternList.json を使う', () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify(flatPattern));
      const result = WorkspaceManager.loadPatterns(['/rbc/failure_patternList.json'], 2);
      expect(result).not.toBeNull();
    });
  });

  describe('パターンJSON の変換', () => {
    test('フラット配列形式 (detectpatternlist) を3階層構造に変換する', () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify(flatPattern));
      const result = WorkspaceManager.loadPatterns(['/rbc/failure_detectpatternlist.json'], 0)!;
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0][0][0].FunctionCallCode).toBe('require("acorn")');
    });

    test('{ patterns: [...] } ラップ形式 (patternList) を3階層構造に変換する', () => {
      const wrapped = { patterns: [{ pattern: flatPattern[0] }] };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(wrapped));
      const result = WorkspaceManager.loadPatterns(['/rbc/failure_patternList.json'], 1)!;
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0][0][0].FunctionCallCode).toBe('require("acorn")');
    });
  });
});
