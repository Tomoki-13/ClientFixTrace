import fs from "fs";

function parse(filePath: string): { libName: string; preVersion: string; postVersion: string }[] {
  const taskList: { libName: string; preVersion: string; postVersion: string }[] = [];
  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const lines = csvContent.split('\n').filter(l => l.trim().length > 0);

  if (lines.length > 0) {
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const libIdx = headers.indexOf('library');
    const preIdx = headers.indexOf('preversion');
    const postIdx = headers.indexOf('postversion');
    const statusIdx = headers.indexOf('status');

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      if (libIdx !== -1 && postIdx !== -1 && statusIdx !== -1) {
        if (cols[statusIdx] === 'SUCCESS') {
          taskList.push({
            libName: cols[libIdx],
            preVersion: cols[preIdx],
            postVersion: cols[postIdx]
          });
        }
      }
    }
  }
  return taskList;
}

export default {
  parse
};