"""Tests for 06_claim_anomaly.py: log decoding, adaptive log fetching, features and risk scoring."""

import pytest

from conftest import load_step

anomaly = load_step("06_claim_anomaly")

ROGUE = "0x0db52747fb322c54d45a405a12ee392f0cbd49f0"
A = "0x959f524d2e3f3d28830d05764b90fd0671fb3f25"
B = "0xfd1237aa2249e0cb3ccea2659a3a963b8a86f456"
C = "0x9584d49c674f685d6cd3463d9bebcff3d8b68923"

T0 = 1_789_700_000


def word(x: int) -> str:
    return hex(x)[2:].rjust(64, "0")


def test_decode_attested():
    log = {
        "topics": [anomaly.ATTESTED_TOPIC, "0x" + word(7), "0x" + word(int(ROGUE, 16)), "0x" + word(1)],
        "data": "0x" + word(0x1748) + word(2026) + word(0x265C),
        "blockNumber": hex(46_964_591),
        "transactionHash": "0xeb48",
        "logIndex": "0x2",
    }
    d = anomaly.decode_attested(log)
    assert d == {
        "id": 7,
        "exporter": ROGUE,
        "grid_id": 1,
        "nullifier": "0x" + word(0x1748),
        "season": 2026,
        "commodity_hash": "0x" + word(0x265C),
        "block": 46_964_591,
        "tx_hash": "0xeb48",
        "log_index": 2,
    }
    with pytest.raises(ValueError):
        anomaly.decode_attested({**log, "topics": ["0x" + word(1)] + log["topics"][1:]})


def test_fetch_logs_splits_until_accepted():
    limit = 10_000
    calls = []
    hits = [5, 25_000, 40_001, 79_999]

    def get_logs(a, b):
        calls.append((a, b))
        if b - a > limit:
            raise anomaly.RpcError("block range too large")
        return [h for h in hits if a <= h <= b]

    assert anomaly.fetch_logs(get_logs, 0, 80_000) == hits
    accepted = sorted(c for c in calls if c[1] - c[0] <= limit)
    assert accepted[0][0] == 0 and accepted[-1][1] == 80_000
    for (a0, b0), (a1, _) in zip(accepted, accepted[1:]):
        assert a1 == b0 + 1  # tiles without gaps or overlaps

    def always_fails(a, b):
        raise anomaly.RpcError("boom")

    with pytest.raises(anomaly.RpcError):
        anomaly.fetch_logs(always_fails, 0, 1_500)


def synthetic_claims():
    claims = [{"exporter": ROGUE, "season": 2026, "ts": T0 + 10 * i} for i in range(25)]
    claims += [{"exporter": A, "season": 2026, "ts": T0 + 86_400 * i} for i in range(2)]
    claims += [{"exporter": B, "season": s, "ts": T0 + 3 * 3600 * i} for i, s in enumerate((2026, 2026, 2025))]
    claims += [{"exporter": C, "season": 2026, "ts": T0 + 500}]
    return claims


def test_build_features():
    rows = {r["address"]: r for r in anomaly.build_features(synthetic_claims(), near_seconds=300)}
    assert set(rows) == {ROGUE, A, B, C}
    r = rows[ROGUE]
    assert r["n_claims"] == 25 and r["max_claims_per_hour"] == 25 and r["near_ratio"] == 1.0
    assert r["peers_same_season"] == 3 and r["seasons"] == [2026]
    a = rows[A]
    assert a["n_claims"] == 2 and a["max_claims_per_hour"] == 1 and a["near_ratio"] == 0.0 and a["span_hours"] == 24.0
    b = rows[B]
    assert b["seasons"] == [2025, 2026] and b["peers_same_season"] == 3 and b["max_claims_per_hour"] == 1
    c = rows[C]
    assert c["n_claims"] == 1 and c["near_ratio"] == 0.0 and c["span_hours"] == 0.0
    assert c["first_claim"].endswith("+00:00")


def test_score_flags_the_rogue():
    rows = anomaly.build_features(synthetic_claims(), near_seconds=300)
    scored, status = anomaly.score(rows, seed=42, near_seconds=300)
    assert status == "ok"
    assert scored[0]["address"] == ROGUE and scored[0]["risk_score"] == 1.0
    assert all(0.0 <= r["risk_score"] <= 1.0 for r in scored)
    assert all(r["risk_score"] < scored[0]["risk_score"] for r in scored[1:])
    reasons = " ".join(scored[0]["reasons"])
    assert "burst: 25 claims within one hour" in reasons and "25 claims vs. a median" in reasons and "100% of claims" in reasons
    for r in scored[1:]:
        assert not any("burst" in x for x in r["reasons"])
    # scoring must be deterministic for a fixed seed
    again, _ = anomaly.score(rows, seed=42, near_seconds=300)
    assert [r["risk_score"] for r in again] == [r["risk_score"] for r in scored]


def test_score_single_exporter():
    rows = anomaly.build_features([{"exporter": C, "season": 2026, "ts": T0}])
    scored, status = anomaly.score(rows)
    assert status == "insufficient_exporters" and scored[0]["risk_score"] == 0.0 and scored[0]["reasons"] == []


def test_read_frontend_config(tmp_path):
    cfg = tmp_path / "config.ts"
    cfg.write_text('export const CHAIN_ID = 84532 as const;\nexport const REGISTRY_ADDRESS = "0xd5569a4557E4CaE10464Ff868f6A3594014D852f" as const;\nexport const REGISTRY_DEPLOY_BLOCK = 46963452;\n')
    assert anomaly.read_frontend_config(cfg) == {"registry": "0xd5569a4557E4CaE10464Ff868f6A3594014D852f", "deploy_block": 46963452, "chain_id": 84532}
