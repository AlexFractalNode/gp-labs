"""Checks that the committed golden JSON files match what scripts/make_golden.py produces now."""
import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import make_golden  # noqa: E402

GOLDEN = ROOT / "tests" / "golden"
EXACT = ["kap9", "exercise5", "sine", "mean_demo", "mean_fit", "kernels", "yacht_split"]


@pytest.fixture(scope="module")
def built():
    return make_golden.build_all()


def load(name):
    with open(GOLDEN / f"{name}.json", encoding="utf8") as f:
        return json.load(f)


def _is_numeric(a):
    try:
        np.asarray(a, float)
        return True
    except (TypeError, ValueError):
        return False


def assert_same(a, b, rtol, atol, path=""):
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), path
        for k in a:
            if k == "meta":
                continue
            assert_same(a[k], b[k], rtol, atol, f"{path}/{k}")
    elif isinstance(a, str) or isinstance(b, str):
        assert a == b, path
    elif isinstance(a, bool) or a is None:
        assert a == b, path
    elif isinstance(a, list) and not _is_numeric(a):
        assert len(a) == len(b), path
        for i, (u, v) in enumerate(zip(a, b)):
            assert_same(u, v, rtol, atol, f"{path}[{i}]")
    else:
        assert np.allclose(np.asarray(a, float), np.asarray(b, float), rtol=rtol, atol=atol), path


@pytest.mark.parametrize("name", EXACT)
def test_deterministic_files_match(built, name):
    assert_same(built[name], load(name), 1e-12, 1e-12, name)


def test_yacht_fixed_matches_loosely(built):
    assert_same(built["yacht_fixed"], load("yacht_fixed"), 1e-3, 1e-8, "yacht_fixed")


def test_every_file_has_meta():
    for p in GOLDEN.glob("*.json"):
        meta = json.loads(p.read_text(encoding="utf8"))["meta"]
        assert meta["generated_by"] == "scripts/make_golden.py"
        assert meta["numpy"] and meta["sklearn"]


def test_kap9_absolute():
    g = load("kap9")
    assert g["mean"][0] == pytest.approx(0.8, abs=1e-12)
    assert g["varF"][0] == pytest.approx(0.2, abs=1e-12)
    assert abs(g["sdY"][0] - 0.6708) < 1e-4
    assert np.allclose(g["intervalF"], [-0.094, 1.694], atol=1e-3)
    assert np.allclose(g["intervalY"], [-0.542, 2.142], atol=1e-3)


def test_exercise5_absolute():
    g = load("exercise5")
    assert g["halfwidthF"] == pytest.approx(0.2)
    assert g["halfwidthY"] == pytest.approx(2 * np.sqrt(0.17))


def test_yacht_split_is_partition():
    g = load("yacht_split")
    assert len(g["train"]) == 277 and len(g["test"]) == 31
    assert sorted(g["train"] + g["test"]) == list(range(308))


def test_yacht_fixed_absolute():
    g = load("yacht_fixed")
    assert abs(g["rmse"] - 0.392) < 0.03
    assert np.allclose(g["y_test_pred"], g["sklearn_y_test_pred"], rtol=0, atol=1e-5)


def test_kernels_numpy_matches_sklearn_where_both_exist():
    pairs = make_golden.kernel_crosschecks()
    assert len(pairs) >= 8
    for name, k_np, k_sk in pairs:
        assert np.allclose(k_np, k_sk, rtol=1e-12, atol=1e-12), name


def test_kernel_matrices_are_symmetric():
    g = load("kernels")
    assert len(g["entries"]) == 14
    for e in g["entries"]:
        K = np.asarray(e["K"])
        assert K.shape == (7, 7)
        assert np.allclose(K, K.T), e["name"]
