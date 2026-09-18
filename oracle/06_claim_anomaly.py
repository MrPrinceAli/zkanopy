#!/usr/bin/env python3
"""Step 06 - on-chain claim anomaly detection (AI component #2, PRD 5.6 /regulator).

Pulls every `Attested` event of the Registry over plain JSON-RPC (no web3.py needed), builds per-exporter
claim-pattern features and scores them with an IsolationForest:

  n_claims             attestations submitted by the exporter
  max_claims_per_hour  busiest 60-minute window (burst)
  near_ratio           share of claims that land within NEAR_SECONDS of the exporter's previous claim
  peers_same_season    distinct other exporters active in the same season(s)

risk_score in [0, 1] is the min-max scaled anomaly score inside the current set (1 = most anomalous exporter).
The chain guarantees the AI's input (only verified proofs become events); the AI watches the chain for patterns.

Outputs: frontend/public/data/risk.json (read by /regulator) and oracle/out/claims.json.
Usage: .venv/bin/python oracle/06_claim_anomaly.py [--rpc URL] [--seed 42] [--near-seconds 300]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
from dotenv import load_dotenv
from sklearn.ensemble import IsolationForest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT_DIR = HERE / "out"
RISK_PATH = ROOT / "frontend" / "public" / "data" / "risk.json"
CONFIG_TS = ROOT / "frontend" / "src" / "config.ts"

# keccak256("Attested(uint256,address,uint256,uint256,uint32,bytes32)") - the event is frozen since Phase 2.
ATTESTED_TOPIC = "0x038a17b3a72e5d0ba962fd1dc5d3b35b6a58d82cb9fee701553485dd577512e7"
FEATURES = ["n_claims", "max_claims_per_hour", "near_ratio", "peers_same_season"]
MIN_SPLIT_RANGE = 2_000
MODEL_PARAMS = {"n_estimators": 200, "contamination": "auto"}


class RpcError(RuntimeError):
    pass


class Rpc:
    def __init__(self, url: str):
        self.url = url
        self._id = 0
        self._s = requests.Session()

    def call(self, method: str, params: list):
        self._id += 1
        r = self._s.post(self.url, json={"jsonrpc": "2.0", "id": self._id, "method": method, "params": params}, timeout=60)
        r.raise_for_status()
        body = r.json()
        if "error" in body:
            raise RpcError(body["error"].get("message", str(body["error"])))
        return body["result"]


def read_frontend_config(path: Path = CONFIG_TS) -> dict:
    src = path.read_text()
    pick = lambda pat, what: (re.search(pat, src) or (_ for _ in ()).throw(ValueError(f"{what} not found in config.ts"))).group(1)
    return {
        "registry": pick(r'REGISTRY_ADDRESS\s*=\s*"(0x[0-9a-fA-F]{40})"', "REGISTRY_ADDRESS"),
        "deploy_block": int(pick(r"REGISTRY_DEPLOY_BLOCK\s*=\s*(\d+)", "REGISTRY_DEPLOY_BLOCK")),
        "chain_id": int(pick(r"CHAIN_ID\s*=\s*(\d+)", "CHAIN_ID")),
    }


def fetch_logs(get_logs, from_block: int, to_block: int, min_split: int = MIN_SPLIT_RANGE) -> list:
    """Calls get_logs(from, to) over the range, halving it whenever the node rejects the request."""
    try:
        return list(get_logs(from_block, to_block))
    except RpcError:
        if to_block - from_block < min_split:
            raise
        mid = from_block + (to_block - from_block) // 2
        return fetch_logs(get_logs, from_block, mid, min_split) + fetch_logs(get_logs, mid + 1, to_block, min_split)


def decode_attested(log: dict) -> dict:
    """Attested(uint256 indexed id, address indexed exporter, uint256 indexed gridId, uint256 nullifier, uint32 season, bytes32 commodityHash)."""
    topics = log["topics"]
    if topics[0].lower() != ATTESTED_TOPIC:
        raise ValueError("not an Attested log")
    data = log["data"][2:]
    return {
        "id": int(topics[1], 16),
        "exporter": "0x" + topics[2][-40:].lower(),
        "grid_id": int(topics[3], 16),
        "nullifier": "0x" + data[0:64],
        "season": int(data[64:128], 16),
        "commodity_hash": "0x" + data[128:192],
        "block": int(log["blockNumber"], 16),
        "tx_hash": log["transactionHash"],
        "log_index": int(log["logIndex"], 16),
    }


def fetch_timestamps(rpc: Rpc, blocks: set[int]) -> dict[int, int]:
    out = {}
    for b in sorted(blocks):
        blk = rpc.call("eth_getBlockByNumber", [hex(b), False])
        out[b] = int(blk["timestamp"], 16)
    return out


def build_features(claims: list[dict], near_seconds: int = 300) -> list[dict]:
    """Per-exporter features from claims [{exporter, season, ts}]. Pure; returns rows sorted by address."""
    by_exp: dict[str, list[dict]] = {}
    for c in claims:
        by_exp.setdefault(c["exporter"].lower(), []).append(c)
    seasons = {e: {c["season"] for c in cs} for e, cs in by_exp.items()}

    rows = []
    for e in sorted(by_exp):
        ts = sorted(c["ts"] for c in by_exp[e])
        n = len(ts)
        best, i = 0, 0
        for j in range(n):
            while ts[j] - ts[i] > 3600:
                i += 1
            best = max(best, j - i + 1)
        diffs = [ts[k] - ts[k - 1] for k in range(1, n)]
        near_ratio = sum(1 for d in diffs if d <= near_seconds) / len(diffs) if diffs else 0.0
        peers = sum(1 for x, s in seasons.items() if x != e and s & seasons[e])
        rows.append(
            {
                "address": e,
                "n_claims": n,
                "max_claims_per_hour": best,
                "near_ratio": round(near_ratio, 4),
                "peers_same_season": peers,
                "span_hours": round((ts[-1] - ts[0]) / 3600, 3),
                "seasons": sorted(seasons[e]),
                "first_claim": datetime.fromtimestamp(ts[0], timezone.utc).isoformat(timespec="seconds"),
                "last_claim": datetime.fromtimestamp(ts[-1], timezone.utc).isoformat(timespec="seconds"),
            }
        )
    return rows


def score(rows: list[dict], seed: int = 42, near_seconds: int = 300) -> tuple[list[dict], str]:
    """Adds anomaly_score, risk_score and reasons; returns (rows sorted by risk desc, status)."""
    rows = [dict(r) for r in rows]
    if len(rows) < 2:
        for r in rows:
            r.update(anomaly_score=0.0, risk_score=0.0, reasons=[])
        return rows, "insufficient_exporters"

    X = np.array([[r[f] for f in FEATURES] for r in rows], dtype=float)
    clf = IsolationForest(random_state=seed, **MODEL_PARAMS).fit(X)
    s = -clf.score_samples(X)  # higher = more anomalous
    lo, hi = float(s.min()), float(s.max())
    risk = (s - lo) / (hi - lo) if hi > lo else np.zeros_like(s)
    med = np.median(X, axis=0)

    for r, a, k in zip(rows, s, risk):
        reasons = []
        m_n, m_burst = med[0], med[1]
        if r["n_claims"] > max(2 * m_n, m_n + 2):
            reasons.append(f"{r['n_claims']} claims vs. a median of {m_n:g}")
        if r["max_claims_per_hour"] > max(2 * m_burst, m_burst + 2):
            reasons.append(f"burst: {r['max_claims_per_hour']} claims within one hour (median {m_burst:g})")
        if r["n_claims"] >= 3 and r["near_ratio"] >= 0.5:
            reasons.append(f"{r['near_ratio']:.0%} of claims within {near_seconds // 60} min of the previous one")
        r.update(anomaly_score=round(float(a), 4), risk_score=round(float(k), 4), reasons=reasons)

    rows.sort(key=lambda r: (-r["risk_score"], -r["n_claims"], r["address"]))
    return rows, "ok"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rpc", default=None, help="JSON-RPC URL (default: RPC_URL from .env)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--near-seconds", type=int, default=300)
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")
    rpc_url = args.rpc or os.environ.get("RPC_URL")
    if not rpc_url:
        print("error: RPC_URL not set", file=sys.stderr)
        return 1
    cfg = read_frontend_config()
    rpc = Rpc(rpc_url)

    chain_id = int(rpc.call("eth_chainId", []), 16)
    if chain_id != cfg["chain_id"]:
        print(f"error: RPC chain {chain_id} != config.ts CHAIN_ID {cfg['chain_id']}", file=sys.stderr)
        return 1
    head = int(rpc.call("eth_blockNumber", []), 16)

    def get_logs(a: int, b: int):
        return rpc.call("eth_getLogs", [{"address": cfg["registry"], "topics": [ATTESTED_TOPIC], "fromBlock": hex(a), "toBlock": hex(b)}])

    raw = fetch_logs(get_logs, cfg["deploy_block"], head)
    claims = [decode_attested(l) for l in raw]
    ts = fetch_timestamps(rpc, {c["block"] for c in claims})
    for c in claims:
        c["ts"] = ts[c["block"]]
    claims.sort(key=lambda c: (c["block"], c["log_index"]))

    rows = build_features(claims, args.near_seconds)
    rows, status = score(rows, args.seed, args.near_seconds)

    risk = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "chainId": chain_id,
        "registry": cfg["registry"],
        "fromBlock": cfg["deploy_block"],
        "toBlock": head,
        "n_claims": len(claims),
        "status": status,
        "model": {"type": "IsolationForest", **MODEL_PARAMS, "random_state": args.seed, "features": FEATURES, "near_seconds": args.near_seconds},
        "exporters": rows,
    }
    RISK_PATH.parent.mkdir(parents=True, exist_ok=True)
    RISK_PATH.write_text(json.dumps(risk, indent=2) + "\n")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "claims.json").write_text(json.dumps(claims, indent=2) + "\n")

    print(f"{len(claims)} Attested events, blocks {cfg['deploy_block']}-{head}, {len(rows)} exporters, status {status}")
    for r in rows:
        print(f"  risk {r['risk_score']:.2f}  {r['address']}  claims {r['n_claims']:3d}  burst/h {r['max_claims_per_hour']:3d}  "
              f"near {r['near_ratio']:.0%}  {'; '.join(r['reasons']) or '-'}")
    print(f"wrote {RISK_PATH.relative_to(ROOT)} and oracle/out/claims.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
