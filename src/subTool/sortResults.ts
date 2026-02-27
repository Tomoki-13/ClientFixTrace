import output_json from "../utils/output_json";
import {loadJsonData_VersionPair} from "../utils/loadJson";
import { VersionPair } from "../types/VersionPair";
import path from "path";
import fs from "fs";

let filePath = '../../output/cloneAndextractOnly_result/uuid/version_history:_451.json';
let data:VersionPair[] = loadJsonData_VersionPair(filePath);
output_json.createOutputDirectory('../../output/sortData');
data = [...data].sort((a, b) => b.count - a.count);
console.log('data:',data);

// 例: 2025-04-19
const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
let outDir = path.join('../../output/sortData', path.basename(filePath).split('.')[0] + date);
output_json.createOutputDirectory(outDir);

//種別によるフィルタリング
console.log('update:',JSON.stringify(data.filter((item) => item.type === 'update'), null, 2));

const updateItems = data.filter(item => item.type === 'update');
const downgradeItems = data.filter(item => item.type === 'downgrade');
const sameItems = data.filter(item => item.type === 'same');

fs.writeFileSync(output_json.getUniqueOutputPath(outDir, '', 'update'), JSON.stringify(updateItems, null, 2));
fs.writeFileSync(output_json.getUniqueOutputPath(outDir, '', 'downgrade'), JSON.stringify(downgradeItems, null, 2));
fs.writeFileSync(output_json.getUniqueOutputPath(outDir, '', 'same'), JSON.stringify(sameItems, null, 2));
