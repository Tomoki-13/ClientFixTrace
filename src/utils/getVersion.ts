import * as fs from 'fs';
import * as path from 'path';

//ステータスを分類後文字列で渡す
export const getVersion =(repoPath: string,libName: string): string  =>{
    if(!repoPath) {
        console.error('path error');
        process.exit(1);
    }

    const packageJsonPath = findPackageJson(repoPath);
    if(packageJsonPath) {
        const verNum = checkDepend(packageJsonPath,libName);
        if(verNum){
            return verNum;
        }
    } else {
        //console.log('no package.json');
        return 'no';
    }
    return 'no';
}

const findPackageJson=(dir: string): string | null =>{
    const filePath = path.join(dir, 'package.json');
    if(fs.existsSync(filePath)) {
        return filePath;
    }
    const parentDir = path.dirname(dir);
    if(parentDir === dir) {
        return null;
    }
    return findPackageJson(parentDir);
}

//
const checkDepend = (packageJsonPath: string,libName: string): string|undefined=>{
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if(packageJson.dependencies && packageJson.dependencies[libName]) {
        const versionNum:string = packageJson.dependencies[libName];
        if(versionNum){
            return versionNum;
        }
    }else{
        return 'no lib';
    }
}