import { _privateForTest, getVersion } from '../git/getVersion';
import path from 'path';

//テストファイル一覧：絶対パス
const dirPath1 = path.join(process.cwd(), './src/__tests__/inputFiles');
const dirPath2 = path.join(process.cwd(), './src/__tests__/inputFiles', 'samplerepo');
const filePath1 = path.join(process.cwd(), './src/__tests__/inputFiles', 'samplerepo', 'package.json');
describe('checkDepend', () => {
  test('default', () => {
    let expectedOutput = "^0.0.1-security";
    expect(_privateForTest.checkDepend(filePath1, 'fs')).toEqual(expectedOutput);
  });
  test('input unused library ', () => {
    let expectedOutput = "no";
    expect(_privateForTest.checkDepend(filePath1, 'lib')).toEqual(expectedOutput);
  });
});

describe('findPackageJson', () => {
  test('default', () => {
    expect(_privateForTest.findPackageJson(dirPath2)).toEqual(filePath1);
  });
  test('input mainrepo package.json ', () => {
    let expectedOutput = path.resolve(process.cwd(), 'package.json');
    expect(_privateForTest.findPackageJson(dirPath1)).toEqual(expectedOutput);
  });
});