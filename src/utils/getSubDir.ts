import { promises as fsPromises, Dirent } from 'fs';
const path = require("path");

//クライアントごとの調査対象ファイルを取得
export const getSubDir = async(directoryPath: string): Promise<string[]> => {
    try {
        const allSubDirs: string[] = [];
        const dirs: Dirent[] = await fsPromises.readdir(directoryPath, { withFileTypes: true });
        
        //各ファイルおよびディレクトリに対して処理
        for(const dir of dirs) {
            if(dir.name != ".DS_Store") {
                const subDirPath: string = path.join(directoryPath, dir.name);
                allSubDirs.push(subDirPath);
            }
        }
        return (allSubDirs);
    } catch (err) {
        console.error('Error:', err);
        throw err; 
    }
}
