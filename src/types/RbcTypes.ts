/**
 * R-BC: 関数呼び出し抽出結果の最小単位
 */
export type ExtractFunctionCallsResult = {
  FunctionCallCode: string; // 関数呼び出しコード
  filePath: string;         // ファイルパス
  line: number;             // 関数呼び出しの行番号
  argTypes: string[][];     // 各関数呼び出しごとに引数の型群
  argContexts: string[][];  // 各関数呼び出しごとの、引数ごとのコードスニペット群
};

/**
 * R-BC: matchResults.json におけるクライアントごとの検出パターン
 */
export type MatchClientPattern = {
  client?: string;
  C_client?: string;
  nameWithOwner?: string;
  pattern: ExtractFunctionCallsResult[];
  detectPattern: ExtractFunctionCallsResult[][];
};

/**
 * R-BC: detect.json におけるパターンごとのカウント情報
 */
export type PatternCount = {
  pattern: ExtractFunctionCallsResult[][];
  count: number;
};

/**
 * R-BC: detect.json の基本出力
 */
export type DetectionOutput = {
  patterns: PatternCount[];
  totalClients: number;
  detectedClients: string[];
};

/**
 * R-BC: detect.json の拡張出力（カウント等の詳細情報を含む）
 */
export type ExtendedDetectionOutput = DetectionOutput & {
  scannedDirCount: number;
  notestCount: number;
  standardCount: number;
  noscriptCount: number;
  noPackagejsonCount: number;
  validDetectedCount: number;
};