import fs from 'fs/promises';
import path from 'path';

// 非同期でディレクトリ内のすべての js / ts / jsx / tsx ファイルを再帰的に取得する関数
export const getAllFiles = async (directoryPath: string): Promise<string[]> => {
    const allFiles: string[] = [];
    try {
        const files = await fs.readdir(directoryPath, { withFileTypes: true });
        for (const file of files) {
            const filePath = path.join(directoryPath, file.name);
            if (file.isFile()) {
                if (
                    (file.name.endsWith('.js') ||
                        file.name.endsWith('.ts') ||
                        file.name.endsWith('.jsx') ||
                        file.name.endsWith('.tsx')) &&
                    !file.name.endsWith('.coffee') &&
                    !file.name.endsWith('.md') &&
                    !file.name.endsWith('.min.js') &&
                    !file.name.endsWith('.dev.js')
                ) {
                    allFiles.push(filePath);
                }
            } else if (file.isDirectory()) {
                if (!filePath.includes('node_modules')) {
                    const subFiles = await getAllFiles(filePath);
                    allFiles.push(...subFiles);
                }
            }
        }
    } catch (err) {
        console.error('Error reading directory:', err);
        throw err;
    }

    return allFiles;
};

// 再帰的にすべてのファイルを取得する関数（フィルタなし）
export const getAllFilesRecursively = async (targetPath: string): Promise<string[]> => {
    const results: string[] = [];
    const stats = await fs.stat(targetPath);
    if (stats.isFile()) {
        return [targetPath];
    }
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name === '.DS_Store') continue;

        const fullPath = path.join(targetPath, entry.name);

        if (entry.isDirectory()) {
            const nestedFiles = await getAllFilesRecursively(fullPath);
            results.push(...nestedFiles);
        } else if (entry.isFile()) {
            results.push(fullPath);
        }
    }
    return results;
};