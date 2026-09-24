"""Shared helpers: the oracle steps are numbered scripts, so load them by path."""

import importlib.util
from pathlib import Path

import pytest

ORACLE = Path(__file__).resolve().parents[1]


def load_step(name: str):
    spec = importlib.util.spec_from_file_location(name, ORACLE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="session")
def build_grid():
    return load_step("02_build_grid")


@pytest.fixture(scope="session")
def ai_qc():
    return load_step("03_ai_qc")


@pytest.fixture(scope="session")
def config(build_grid):
    # Each region has its own config since Phase 7; the Aceh grid is the published default.
    return build_grid.load_config(ORACLE / "regions" / "gayo-aceh.yaml")
