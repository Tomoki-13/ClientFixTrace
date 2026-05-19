import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { ExtractFunctionCallsResult } from "../types/RbcTypes";

// ----------------------------------------------------------------
// リポジトリ管理
// ----------------------------------------------------------------

/**
 * 原本リポジトリのパスを解決する。
 * sourceReposRoot → clonedata/temp/master の順でフォールバック。
 * どこにも存在しない場合は null を返す。
 */
function resolveSourcePath(
  sourceReposRoot: string,
  libName: string,
  clientName: string
): string | null {
  const candidates = [
    path.resolve(sourceReposRoot, libName, clientName),
    path.resolve(process.cwd(), '../clonedata/temp/master', libName, clientName),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * リポジトリを一時ディレクトリへコピーし、指定ハッシュへチェックアウトする。
 * 成功すれば true、失敗すれば false を返す。
 */
function checkoutToDir(
  sourcePath: string,
  destPath: string,
  commitHash: string
): boolean {
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

// ----------------------------------------------------------------
// RBC パターン管理
// ----------------------------------------------------------------

/**
 * 検出モードに応じたパターンファイルを選択し、3階層構造に変換して返す。
 *   mode 0 → detectpatternlist.json (型なし広域マッチ)
 *   mode 1/2 → patternList.json (型情報あり)
 * 対応ファイルが見つからない場合は null を返す。
 */
function loadPatterns(
  rbcFiles: string[],
  detectMode: 0 | 1 | 2
): { patterns: ExtractFunctionCallsResult[][][] } | null {
  let patternFile: string | undefined;
  if (detectMode === 0) {
    patternFile =
      rbcFiles.find(f => f.includes('detectpatternlist.json')) ??
      rbcFiles.find(f => f.includes('patternList.json'));
  } else {
    patternFile = rbcFiles.find(f =>
      f.includes('patternList.json') && !f.includes('detectpatternlist.json')
    );
  }
  if (!patternFile) return null;

  const raw = JSON.parse(fs.readFileSync(patternFile, 'utf-8')) as any;
  const rawPatterns: any[] = raw?.patterns
    ? raw.patterns.map((p: any) => p.pattern)
    : (raw || []);
  const patterns: ExtractFunctionCallsResult[][][] = rawPatterns.map((p: any[]) =>
    p.map((bg: any[]) => bg.flatMap(b => Array.isArray(b) ? b : [b]))
  );
  return { patterns };
}

export default { resolveSourcePath, checkoutToDir, loadPatterns };
