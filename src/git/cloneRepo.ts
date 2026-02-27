import fs from "fs";
import { exec,execSync } from 'child_process';
import path from 'path';
import output_json from "../utils/output_json";
import { promisify } from 'util';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const execAsync = promisify(exec);
//リポジトリをクローンする関数(パス名を返す)
export const cloneRepo = async (repo: string, clone_dir: string): Promise<string|null> => {
    const repoUrl = `https://github.com/${repo}.git`;
    const match = repo.match(/(.+?)\/(.+)/);

    if (!match) {
        throw new Error("無効なリポジトリです");
    }

    const userName = match[1];
    const repoName = match[2];
    let cloneCommand:string = '';
    const userDir = path.join(clone_dir, userName);
    const repoDir = path.join(userDir, repoName);
    output_json.createOutputDirectory(userDir);

    // リポジトリのディレクトリが存在するか確認
    if (!fs.existsSync(repoDir)) {
        try {
            output_json.createOutputDirectory(repoDir);
            cloneCommand = `git clone ${repoUrl} ${repoDir}`;
            await execAsync(cloneCommand);
            await sleep(2000);
            //console.log(`Successfully cloned: ${repo}`);
            //.git のみのディレクトリも「中身なし」と見なす
            const contents = fs.readdirSync(repoDir).filter(item => item !== '.git');
            console.log('contents.length:',contents.length);
            if (contents.length === 0) {
                await sleep(1000);
                if (fs.existsSync(repoDir)) {
                    fs.rmSync(repoDir, { recursive: true, force: true });
                    console.log(`Directory was empty (only .git) after clone, deleted: ${repo}`);
                }
                return null;
            }
        } catch (error: any) {
            console.log(`Error cloning repository ${repo}`);
            if (fs.existsSync(repoDir)) {
                await sleep(1000);
                fs.rmSync(repoDir, { recursive: true, force: true });
                console.log(`delete success: ${repo}`);
            }
            return null;
        }
    }else{
        console.log(`Repository already exists: ${repo}`);
    }

    return repoDir;
};
