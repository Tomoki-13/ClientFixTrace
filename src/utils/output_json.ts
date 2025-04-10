import * as fs from 'fs';
import * as path from 'path';

const createOutputDirectory = (dirPath: string): void => {
    if(!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
        console.log(dirPath);
    }
};

const getUniqueOutputPath = (baseDir: string, baseName: string, name: string): string => {
    let outputPath = path.join(baseDir, `${baseName}_${name}.json`);
    if(fs.existsSync(outputPath)) {
        const date = new Date();
        const formattedDate = date.toISOString().slice(0, 19).replace(/[T:]/g, '-');
        outputPath = path.join(baseDir, `${baseName}_${name}_${formattedDate}.json`);
    }
    return outputPath;
};
export default {
    createOutputDirectory,
    getUniqueOutputPath
};