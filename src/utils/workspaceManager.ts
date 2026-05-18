// src/utils/WorkspaceManager.ts
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { ExtractFunctionCallsResult } from "../types/RbcTypes";

export default class WorkspaceManager {
  // --- リポジトリ管理 ---

  // 複数のフォールバックパスから原本リポジトリを探索
  static resolveSourcePath(libName: string, clientName: string, verKey?: string, targetState?: string): string | null {
    const cwd = process.cwd();
    const searchPaths = [
      path.resolve(cwd, `../clonedata/clientRepos/${libName}/${clientName}`),
      path.resolve(cwd, `../clonedata/temp/master/${libName}/${clientName}`)
    ];
    if (verKey && targetState) {
      searchPaths.push(path.resolve(cwd, `../clonedata/repos/clientRepos_all/${libName}/${verKey}/${targetState}/${clientName}`));
    }
    for (const p of searchPaths) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  // 作業ディレクトリへコピーしチェックアウト
  static checkoutCommit(sourcePath: string, destPath: string, commitHash: string): boolean {
    try {
      if (!fs.existsSync(sourcePath)) return false;
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.cpSync(sourcePath, destPath, { recursive: true });
      execSync(`git -C "${destPath}" checkout -f ${commitHash}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  // --- RBCデータ管理 ---

  // 状態に応じたdetect/patternファイルを特定
  static findRbcFiles(rbcFiles: string[], targetState: string) {
    const detectFile = rbcFiles.find(f => f.endsWith(`${targetState}_detect.json`));
    const detectPatternFile = rbcFiles.find(f => f.includes('detectpatternlist.json'));
    const fallbackPatternFile = rbcFiles.find(f => f.includes('patternList.json'));
    return {
      detectFile,
      patternFile: detectPatternFile || fallbackPatternFile,
      patternModeFlag: detectPatternFile ? 0 : 1
    };
  }

  // パターンJSONをAST用の多重配列にパース
  static extractPatterns(patternFilePath: string): ExtractFunctionCallsResult[][][] {
    try {
      const content = fs.readFileSync(patternFilePath, 'utf-8');
      const raw = JSON.parse(content)?.patterns?.map((p: any) => p.pattern) || JSON.parse(content) || [];
      return raw.map((p: any[]) => p.map((bg: any[]) => bg.flatMap(b => Array.isArray(b) ? b : [b])));
    } catch {
      return [];
    }
  }
}