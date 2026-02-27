import fs from "fs";
import path from "path";
import { specificCommit } from "../../R-BC/src/types/specificCommit";
import { getAllFilesRecursively } from "../../R-BC/src/utils/getAllFiles";
import { cloneRepoWithCommit } from "../../R-BC/src/utils/cloneRepoWithCommit";
import { execSync } from 'child_process';
import output_json from "../utils/output_json";

export async function clone(dirPath: string) {
  const data_path = path.resolve(process.cwd(), dirPath);
  console.log(`データパス: ${data_path}`);

  if (!fs.existsSync(data_path)) {
    console.error(`ディレクトリが存在しません: ${data_path}`);
    return;
  }

  const data_files: string[] = await getAllFilesRecursively(data_path);

  for (let i = 0; i < data_files.length; i++) {
    const data: specificCommit[] = JSON.parse(fs.readFileSync(data_files[i], 'utf-8'));
    const fileNameWithExt = data_files[i].split('/').pop() || '';
    const fileNameWithoutExt = fileNameWithExt.replace(/\.[^/.]+$/, '');
    let output_path = path.resolve(process.cwd(), '../../allupdateSuccessClient/' + fileNameWithoutExt);
    output_json.createOutputDirectory(output_path);
    let count = 0;

    for (const element of data) {
      // 入力形式 "user/repo" からユーザー名とリポジトリ名を取得
      const parts = element.client.split('/');
      if (parts.length < 2) {
        console.error(`無効なリポジトリ形式です: ${element.client}`);
        continue;
      }

      const repoName = parts[parts.length - 1];
      const userName = parts[parts.length - 2];
      const repoIdentifier = `${userName}/${repoName}`;

      // cloneRepoWithCommitが作成するディレクトリ構造 (user/repo) に合わせてパスを指定
      const targetRepoDir = path.join(output_path, userName, repoName);

      // 既にリポジトリが存在する場合の処理
      if (fs.existsSync(targetRepoDir)) {
        try {
          // 既存リポジトリ内でコミットIDを取得して比較
          const currentCommit = execSync('git rev-parse HEAD', { cwd: targetRepoDir, encoding: 'utf-8' }).trim();

          if (currentCommit !== element.commit) {
            console.log(`コミットIDが異なります: ${repoIdentifier} (Current: ${currentCommit}, Expected: ${element.commit})`);
          } else {
            console.log(`既存リポジトリは指定のコミットIDと一致します: ${repoIdentifier}`);
          }

          count++;
          continue;

        } catch (e) {
          console.error(`git情報の取得に失敗しました: ${repoIdentifier}`);
          continue;
        }
      }

      let repo: string | null = await cloneRepoWithCommit(element.client, output_path, element.commit);
      if (repo?.length) {
        count++;
      }
    };
    console.log(`クローン完了: リポジトリ数${data.length} - 成功数: ${count}`);
  }
}

(async () => {
  await clone('../../datasets/input/2025-12-23-07-04-43/specific-update-commit');
})();