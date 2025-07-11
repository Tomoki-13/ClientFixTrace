import fs from 'fs';
import path from "path";
//非同期でディレクトリ内のすべてのjsまたはtsファイルを再帰的に取得する関数

export const getAllFiles = async (directoryPath: string): Promise<string[]> => {
    return new Promise<string[]>((resolve, reject) => {
        fs.readdir(directoryPath, { withFileTypes: true }, async (err, files) => {
            if(err) {
                console.error('Error fs.readdir(directoryPath, { withFileTypes: true }, async (err, files):', err);
                reject(err);
                return;
            }

        const allFiles: string[] = [];

        //各ファイルおよびディレクトリに対して処理
        for(const file of files) {
            const filePath: string = path.join(directoryPath, file.name);

            //jsまたはtsファイルの場合は配列に追加 
            if((file.isFile()) &&(file.name.endsWith(".json"))){
                    allFiles.push(filePath);
                } else if(file.isDirectory()) {
                    //サブディレクトリの場合は再帰的に処理
                    if(!filePath.includes('node_modules')) {
                        const subDirectoryFiles: string[] = await getAllFiles(filePath);
                        allFiles.push(...subDirectoryFiles);
                    }
            }
        }
        resolve(allFiles);
        });
    });
}