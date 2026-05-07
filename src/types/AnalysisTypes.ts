// types/AnalysisTypes.ts

/**
 * clone_summary.csv の1行分を表すデータ構造
 */
export interface TargetUpdate {
  libName: string;
  preVersion: string;
  postVersion: string;
  SuccessCloned: number;
  FailureCloned: number;
  Status: string;
}

/**
 * 全体の実行統計・集計サマリー (analysis_summary_*.csv 用)
 */
export interface ExecutionStat {
  library: string;
  preVersion: string;
  postVersion: string;
  state: string;
  phase: string;
  rbcTotalPatternCount: number;
  targetUpdatedClients: number;
  activeAnalyzed: number;
  notFixed_PatternDetected: number;
  fixed_ImplementationChanged: number;
  downgraded: number;
  noRelease: number;
  unknownError: number;
}

/**
 * クライアントごとのフェーズ推移トラッキング (client_detailed_tracking_*.csv 用)
 */
export interface ClientTrack {
  Library: string;
  Client: string;
  State: string;
  PreVersion: string;
  PostVersion: string;
  Update_LibVer: string;
  Update_Status: string;
  R1_LibVer: string;
  R1_Status: string;
  R2_LibVer: string;
  R2_Status: string;
  R3_LibVer: string;
  R3_Status: string;
}

/**
 * 解析条件から省かれたクライアント情報 (excluded_clients_summary_*.csv 用)
 */
export interface ExcludedClient {
  Library: string;
  Client: string;
  State: string;
  PreVersion: string;
  PostVersion: string;
}