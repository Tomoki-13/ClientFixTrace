import fs from 'fs';
import path from 'path';

function createDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function formatDateTime(date: Date): string {
  const f = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${f(date.getMonth() + 1)}-${f(date.getDate())}-${f(date.getHours())}-${f(date.getMinutes())}-${f(date.getSeconds())}`;
}

function getUniquePath(baseDir: string, baseName: string, name: string): string {
  let outputPath = path.join(baseDir, `${baseName}_${name}.json`);
  if (fs.existsSync(outputPath)) {
    outputPath = path.join(baseDir, `${baseName}_${name}_${formatDateTime(new Date())}.json`);
  }
  return outputPath;
}

export default { 
  createDir,
  formatDateTime,
  getUniquePath
};