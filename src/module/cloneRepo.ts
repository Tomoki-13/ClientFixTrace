import fs from "fs";
import { exec,execSync } from 'child_process';
import path from 'path';
import output_json from "../utils/output_json";
import { promisify } from 'util';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const execAsync = promisify(exec);
//リポジトリをクローンする関数(パス名を返す)
export const cloneRepo = async (repo: string, clone_dir: string): Promise<string> => {
    const repoUrl = `https://github.com/${repo}.git`;
    const match = repo.match(/(.+?)\/(.+)/);

    if (!match) {
        throw new Error("無効なリポジトリです");
    }

    const userName = match[1];
    const repoName = match[2];

    let uni_clientDir = path.join(clone_dir, userName);
    output_json.createOutputDirectory(uni_clientDir);
    let cloneCommand:string = '';
    uni_clientDir = path.join(uni_clientDir, repoName);
    // リポジトリのディレクトリが存在するか確認
    if (!fs.existsSync(uni_clientDir)) {
        try {
            output_json.createOutputDirectory(uni_clientDir);
            cloneCommand = `git clone ${repoUrl} ${uni_clientDir}`;
            await execAsync(cloneCommand);
            await sleep(2000);
            //console.log(`Successfully cloned: ${repo}`);
        } catch (error: any) {
            throw new Error(`Error cloning repository ${repo}: ${error.stderr || error.message}`);
        }
    }else{
        console.log(`Repository already exists: ${repo}`);
    }

    return uni_clientDir;
};
