// risk.json produced by oracle/06_claim_anomaly.py (AI component #2).

export interface RiskExporter {
  address: string;
  n_claims: number;
  max_claims_per_hour: number;
  near_ratio: number;
  peers_same_season: number;
  span_hours: number;
  seasons: number[];
  first_claim: string;
  last_claim: string;
  anomaly_score: number;
  risk_score: number;
  reasons: string[];
}

export interface RiskFile {
  generatedAt: string;
  chainId: number;
  registry: string;
  fromBlock: number;
  toBlock: number;
  n_claims: number;
  status: string;
  model: { type: string; features: string[]; near_seconds: number };
  exporters: RiskExporter[];
}

export async function loadRisk(): Promise<RiskFile> {
  const r = await fetch("/data/risk.json");
  if (!r.ok) throw new Error(`risk.json: HTTP ${r.status}`);
  return (await r.json()) as RiskFile;
}

export const riskClass = (r: number) => (r >= 0.7 ? "bad" : r >= 0.4 ? "warn" : "ok");
