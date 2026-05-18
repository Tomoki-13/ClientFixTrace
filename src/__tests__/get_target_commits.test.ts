import TargetCommits from '../analysis/targetCommits';
import { Client_Ver } from '../types/VersionCommits';

describe('get_target_commits.ts test', () => {
  test('ターゲットバージョン以上の最初の履歴を抽出し、事前・事後の情報を作れること', () => {
    const mockData: Client_Ver[] = [
      {
        C_client: 'test/client-A',
        verList: [
          { L_libVersion: '1.0.0', C_commitID: 'commit-1', C_tagCommitID: 'tag-1', C_releaseVersion: '', C_preReleaseVersion: '' },
          { L_libVersion: '2.0.0', C_commitID: 'commit-2', C_tagCommitID: 'tag-2', C_releaseVersion: '', C_preReleaseVersion: '' },
          { L_libVersion: '3.0.0', C_commitID: 'commit-3', C_tagCommitID: 'tag-3', C_releaseVersion: '', C_preReleaseVersion: '' }
        ]
      }
    ];

    // ターゲットバージョンを '2.0.0' に指定
    const result = TargetCommits.get(mockData, 'test-lib', '2.0.0');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      C_client: 'test/client-A',
      L_libName: 'test-lib',
      L_targetVersion: '2.0.0',
      L_preLibVersion: '1.0.0',  // 2.0.0 の1つ前のバージョン
      L_postLibVersion: '2.0.0', // ターゲットに合致したバージョン
      C_commitID: 'commit-2',
      C_tagCommitID: 'tag-2'
    });
  });

  test('該当するバージョンが存在しない場合は空配列を返すこと', () => {
    const mockData: Client_Ver[] = [
      {
        C_client: 'test/client-B',
        verList: [
          { L_libVersion: '1.0.0', C_commitID: 'commit-1', C_tagCommitID: 'tag-1', C_releaseVersion: '', C_preReleaseVersion: '' }
        ]
      }
    ];

    // クライアントは1.0.0までしか持っていないのに、4.0.0を探す
    const result = TargetCommits.get(mockData, 'test-lib', '4.0.0');
    expect(result).toHaveLength(0);
  });
});