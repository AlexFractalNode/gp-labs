"""Generate the golden JSON files in tests/golden/ (the oracle for the TypeScript GP maths).

Run via `npm run golden`. All kernels follow the PyMC convention used by the TypeScript code.
sklearn is used where a call reproduces the PyMC-convention matrix exactly (see sk_kernel);
everything else is an explicit NumPy transcription of the PyMC formula. Those entries check
the transcription, not PyMC itself.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from scipy.linalg import cholesky, solve_triangular
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import (
    RBF,
    ConstantKernel,
    DotProduct,
    ExpSineSquared,
    Matern,
    RationalQuadratic,
    WhiteKernel,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "golden"
YACHT = ROOT / "public" / "data" / "yacht.csv"
META = {"numpy": np.__version__, "sklearn": sklearn.__version__, "generated_by": "scripts/make_golden.py"}


# ---------------------------------------------------------------- GP core (Notebook Code 39 logic)

def posterior(K, K_star2, K_star, y, sigma_n, m_X=None, m_star=None):
    """compute_gpr_parameters: one Cholesky factorisation, triangular solves, no inverse."""
    n = K.shape[0]
    m_X = np.zeros(n) if m_X is None else m_X
    m_star = np.zeros(K_star.shape[0]) if m_star is None else m_star
    L = cholesky(K + sigma_n**2 * np.eye(n), lower=True)
    q = solve_triangular(L, y - m_X, lower=True)
    beta = solve_triangular(L.T, q, lower=False)
    V = solve_triangular(L, K_star.T, lower=True)
    mean = m_star + K_star @ beta
    cov = K_star2 - V.T @ V
    return mean, (cov + cov.T) / 2, L, q


def log_ml(L, q):
    n = len(q)
    return float(-0.5 * (q @ q) - np.log(np.diag(L)).sum() - 0.5 * n * np.log(2 * np.pi))


def fit_mean_gls(C, H, y):
    """fit_mean_gls: GLS coefficients at fixed C (whitened least squares)."""
    L = cholesky(C, lower=True)
    Hw = solve_triangular(L, H, lower=True)
    yw = solve_triangular(L, y, lower=True)
    eta = np.linalg.lstsq(Hw, yw, rcond=None)[0]
    return eta, L


def rbf_matrix(x, z, sigma_f, ell):
    return sigma_f**2 * np.exp(-np.subtract.outer(x, z) ** 2 / (2 * ell**2))


def lst(a):
    return np.asarray(a, dtype=float).tolist()


# ---------------------------------------------------------------- simple files

def build_kap9():
    x, y = np.array([0.0]), np.array([1.0])
    sigma_f, ell, sigma_n = 1.0, 1.0, 0.5
    xs = np.array([0.0, 1.0, 3.0])
    K = rbf_matrix(x, x, sigma_f, ell)
    mean, cov, _, _ = posterior(K, rbf_matrix(xs, xs, sigma_f, ell), rbf_matrix(xs, x, sigma_f, ell), y, sigma_n)
    var_f = np.diag(cov)
    sd_f = np.sqrt(np.maximum(var_f, 0))
    sd_y = np.sqrt(sd_f**2 + sigma_n**2)
    return {
        "meta": META, "x": lst(x), "y": lst(y), "sigma_f": sigma_f, "ell": ell, "sigma_n": sigma_n,
        "x_star": lst(xs), "mean": lst(mean), "varF": lst(var_f), "sdF": lst(sd_f), "sdY": lst(sd_y),
        "intervalF": [float(mean[0] - 2 * sd_f[0]), float(mean[0] + 2 * sd_f[0])],
        "intervalY": [float(mean[0] - 2 * sd_y[0]), float(mean[0] + 2 * sd_y[0])],
    }


def build_exercise5():
    mean, sd_f, sigma_n = 2.0, 0.1, 0.4
    return {
        "meta": META, "mean": mean, "sdF": sd_f, "sigma_n": sigma_n,
        "halfwidthF": 2 * sd_f, "halfwidthY": float(2 * np.sqrt(sd_f**2 + sigma_n**2)),
    }


def build_sine():
    x = np.linspace(0, 1, 500)
    y = np.sin(4 * np.pi * x) + np.sin(7 * np.pi * x) + np.random.default_rng(2026).normal(0, 0.4, 500)
    xs = np.linspace(0, 1, 100)
    sigma_f, ell, sigma_n = 2.0, 0.1, 0.4
    mean, cov, L, q = posterior(
        rbf_matrix(x, x, sigma_f, ell), rbf_matrix(xs, xs, sigma_f, ell), rbf_matrix(xs, x, sigma_f, ell), y, sigma_n
    )
    return {
        "meta": META, "x": lst(x), "y": lst(y), "x_star": lst(xs),
        "sigma_f": sigma_f, "ell": ell, "sigma_n": sigma_n,
        "mean": lst(mean), "diagCov": lst(np.diag(cov)), "logML": log_ml(L, q),
    }


def build_mean_demo():
    x = np.array([0.0, 0.3, 0.7, 1.0])
    y = np.array([20.1, 20.8, 22.0, 22.9])
    xq = np.linspace(-1, 2, 180)
    sigma_f, ell, sigma_n = 1.0, 0.25, 0.2
    K, Kss, Ks = rbf_matrix(x, x, sigma_f, ell), rbf_matrix(xq, xq, sigma_f, ell), rbf_matrix(xq, x, sigma_f, ell)
    means = {
        "zero": lambda z: np.zeros_like(z),
        "constant22": lambda z: np.full_like(z, 22.0),
        "linear": lambda z: 20.0 + 3.0 * z,
    }
    out = {}
    for name, fn in means.items():
        mean, cov, _, _ = posterior(K, Kss, Ks, y, sigma_n, fn(x), fn(xq))
        out[name] = {"mean": lst(mean), "sdF": lst(np.sqrt(np.maximum(np.diag(cov), 0)))}
    return {
        "meta": META, "x": lst(x), "y": lst(y), "x_query": lst(xq),
        "sigma_f": sigma_f, "ell": ell, "sigma_n": sigma_n, "means": out,
    }


def build_mean_fit():
    x = np.linspace(0, 2, 25)
    y = 20 + 3 * x + 0.4 * np.sin(5 * x) + np.random.default_rng(123).normal(0, 0.1, 25)
    H = np.column_stack([np.ones(len(x)), x])
    noise, signal, length = 0.1, 0.8, 0.6
    C = rbf_matrix(x, x, signal, length) + noise**2 * np.eye(len(x))
    eta, L = fit_mean_gls(C, H, y)
    q = solve_triangular(L, y - H @ eta, lower=True)
    return {
        "meta": META, "x_fit": lst(x), "y_fit": lst(y), "noise": noise, "signal": signal, "length": length,
        "eta": lst(eta), "logML": log_ml(L, q),
    }


# ---------------------------------------------------------------- kernels

SQ2 = float(np.sqrt(2.0))
GRID = np.linspace(0, 2, 7)


def _r(x, z, ell):
    return np.abs(np.subtract.outer(x, z)) / ell


def np_kernel(kind, p, x, z, same):
    """Explicit NumPy transcription of the PyMC-convention formulas (1-D inputs)."""
    d = np.subtract.outer(x, z)
    if kind == "rbf":
        return p["sigma"] ** 2 * np.exp(-_r(x, z, p["ell"]) ** 2 / 2)
    if kind == "matern32":
        r = _r(x, z, p["ell"])
        return p["sigma"] ** 2 * (1 + np.sqrt(3) * r) * np.exp(-np.sqrt(3) * r)
    if kind == "matern52":
        r = _r(x, z, p["ell"])
        return p["sigma"] ** 2 * (1 + np.sqrt(5) * r + 5 * r**2 / 3) * np.exp(-np.sqrt(5) * r)
    if kind == "exponential":
        return p["sigma"] ** 2 * np.exp(-_r(x, z, p["ell"]) / 2)
    if kind == "rq":
        r = _r(x, z, p["ell"])
        return p["sigma"] ** 2 * (1 + r**2 / (2 * p["alpha"])) ** (-p["alpha"])
    if kind == "periodic":
        return p["sigma"] ** 2 * np.exp(-0.5 * np.sin(np.pi * np.abs(d) / p["period"]) ** 2 / p["ell"] ** 2)
    if kind == "cosine":
        return p["sigma"] ** 2 * np.cos(2 * np.pi * np.abs(d) / p["ell"])
    if kind == "linear":
        return p["sigma0"] ** 2 + np.multiply.outer(x - p["c"], z - p["c"])
    if kind == "polynomial":
        return (np.multiply.outer(x - p["c"], z - p["c"]) + p["offset"]) ** p["degree"]
    if kind == "constant":
        return np.full((len(x), len(z)), float(p["c"]))
    if kind == "white":
        return p["sigma"] ** 2 * np.eye(len(x)) if same else np.zeros((len(x), len(z)))
    if kind == "gibbs":
        def l_of(t):
            return (p["l1"] + p["l2"]) / 2 - (p["l1"] - p["l2"]) / 2 * np.tanh((t - p["x0"]) / p["w"])
        lx, lz = l_of(x)[:, None], l_of(z)[None, :]
        return (np.sqrt(2 * lx * lz / (lx**2 + lz**2)) * p["sigma"] ** 2
                * np.exp(-(x[:, None] - z[None, :]) ** 2 / (lx**2 + lz**2)))
    if kind == "powexp":
        return p["sigma"] ** 2 * np.exp(-_r(x, z, p["ell"]) ** p["p"])
    raise ValueError(kind)


def sk_kernel(kind, p):
    """sklearn kernel reproducing the PyMC-convention matrix, or None if there is no exact counterpart."""
    fx = "fixed"

    def s2():
        return ConstantKernel(p["sigma"] ** 2, constant_value_bounds=fx)

    if kind == "rbf":
        return s2() * RBF(p["ell"], length_scale_bounds=fx)
    if kind in ("matern32", "matern52"):
        return s2() * Matern(p["ell"], length_scale_bounds=fx, nu=1.5 if kind == "matern32" else 2.5)
    if kind == "exponential":
        return s2() * Matern(2 * p["ell"], length_scale_bounds=fx, nu=0.5)
    if kind == "rq":
        return s2() * RationalQuadratic(p["ell"], p["alpha"], length_scale_bounds=fx, alpha_bounds=fx)
    if kind == "periodic":
        return s2() * ExpSineSquared(2 * p["ell"], p["period"], length_scale_bounds=fx, periodicity_bounds=fx)
    if kind == "linear" and p["c"] == 0:
        return DotProduct(p["sigma0"], sigma_0_bounds=fx)
    if kind == "constant":
        return ConstantKernel(p["c"], constant_value_bounds=fx)
    if kind == "white":
        return WhiteKernel(p["sigma"] ** 2, noise_level_bounds=fx)
    return None


def factor(kind, params, fixed=(), warp=None):
    f = {"kind": kind, "params": params, "fixed": list(fixed)}
    if warp is not None:
        f["warp"] = warp
    return f


def warp_input(warp, x):
    """Input warp (Notebook Code 64/65). Returns an (n, d) array; circle maps 1-D to 2-D."""
    if warp["kind"] == "tanh":
        return (1.0 + x + warp["a"] * np.tanh(warp["b"] * (x - warp["c"])))[:, None]
    if warp["kind"] == "circle":
        c = 2.0 * np.pi / warp["period"]
        return np.column_stack([np.sin(c * x), np.cos(c * x)])
    raise ValueError(warp["kind"])


def np_warped_rbf(p, u, v):
    """rbf on (possibly multi-dimensional) warped inputs with Euclidean distance."""
    d2 = ((u[:, None, :] - v[None, :, :]) ** 2).sum(-1)
    return p["sigma"] ** 2 * np.exp(-d2 / (2 * p["ell"] ** 2))


# (name, terms) with terms = sum of products of factors
KERNEL_ENTRIES = [
    ("Matern52", [[factor("matern52", {"sigma": SQ2, "ell": 0.2})]]),
    ("Matern32", [[factor("matern32", {"sigma": SQ2, "ell": 0.2})]]),
    ("RBF", [[factor("rbf", {"sigma": 2.0, "ell": 0.2})]]),
    ("White", [[factor("white", {"sigma": 2.0})]]),
    ("Constant", [[factor("constant", {"c": 2.0})]]),
    ("RationalQuadratic", [[factor("rq", {"sigma": SQ2, "ell": 0.2, "alpha": 0.1})]]),
    ("Exponential", [[factor("exponential", {"sigma": 1.0, "ell": 0.2})]]),
    ("Cosine", [[factor("cosine", {"sigma": 1.0, "ell": 0.5})]]),
    ("Linear", [[factor("linear", {"sigma0": 0.0, "c": 1.0}, ["sigma0", "c"])]]),
    ("Polynomial", [[factor("polynomial", {"c": 1.0, "offset": 1.0, "degree": 3.0}, ["c", "offset", "degree"])]]),
    ("Gibbs", [[factor("gibbs", {"sigma": 1.0, "l1": 0.05, "l2": 0.6, "w": 0.3, "x0": 1.0}, ["x0"])]]),
    ("PowerExponential", [[factor("powexp", {"sigma": 1.0, "ell": 0.5, "p": 2.0}, ["p"])]]),
    ("Linear+Periodic", [[factor("linear", {"sigma0": 1.0, "c": 0.0}, ["c"])],
                         [factor("periodic", {"sigma": 1.0, "ell": 1.0, "period": 0.5})]]),
    ("RBF*Periodic", [[factor("rbf", {"sigma": 1.0, "ell": 1.0}),
                       factor("periodic", {"sigma": 1.0, "ell": 1.0, "period": 0.5})]]),
    ("Periodic", [[factor("periodic", {"sigma": 1.0, "ell": 1.0, "period": 1.0})]]),
    ("RBF-TanhWarp", [[factor("rbf", {"sigma": 1.0, "ell": 0.2}, warp={"kind": "tanh", "a": 1.0, "b": 5.0, "c": 1.0})]]),
    ("RBF-CircleWarp", [[factor("rbf", {"sigma": 1.0, "ell": 0.4}, warp={"kind": "circle", "period": 0.5})]]),
]

# Entries evaluated on their own grid (stored as entry["x"]); e.g. Gibbs needs a finer grid so that the
# interpolation of l(x) between l1 and l2 around x0 is actually exercised.
FINE_GRID = np.linspace(0, 2, 25)
KERNEL_ENTRIES_OWN_GRID = [
    ("Gibbs-Fine", FINE_GRID,
     [[factor("gibbs", {"sigma": 1.0, "l1": 0.05, "l2": 0.6, "w": 0.3, "x0": 1.0}, ["x0"])]]),
]


def _terms_matrix(terms, x, z, same, use_sklearn):
    """Matrix of a sum-of-products spec; returns (K, whether every factor has a sklearn counterpart)."""
    total = np.zeros((len(x), len(z)))
    all_sk = True
    for term in terms:
        prod = np.ones((len(x), len(z)))
        for f in term:
            if "warp" in f:
                # Warped inputs: NumPy transcription only (rbf is the only warped kind in the golden set).
                assert f["kind"] == "rbf"
                all_sk = False
                prod = prod * np_warped_rbf(f["params"], warp_input(f["warp"], x), warp_input(f["warp"], z))
                continue
            sk = sk_kernel(f["kind"], f["params"])
            all_sk = all_sk and sk is not None
            if use_sklearn and sk is not None:
                k = sk(x[:, None]) if same else sk(x[:, None], z[:, None])
            else:
                k = np_kernel(f["kind"], f["params"], x, z, same)
            prod = prod * k
        total = total + prod
    return total, all_sk


def build_kernels():
    entries = []
    for name, terms in KERNEL_ENTRIES:
        K, all_sk = _terms_matrix(terms, GRID, GRID, True, True)
        entries.append({
            "name": name, "spec": {"terms": terms}, "K": lst(K),
            "source": "sklearn" if all_sk else "numpy-transcription",
        })
    for name, grid, terms in KERNEL_ENTRIES_OWN_GRID:
        K, all_sk = _terms_matrix(terms, grid, grid, True, True)
        entries.append({
            "name": name, "x": lst(grid), "spec": {"terms": terms}, "K": lst(K),
            "source": "sklearn" if all_sk else "numpy-transcription",
        })
    return {"meta": META, "x": lst(GRID), "entries": entries}


def kernel_crosschecks():
    """(name, numpy matrix, sklearn matrix) for every entry that has an sklearn counterpart."""
    pairs = []
    for name, terms in KERNEL_ENTRIES:
        k_sk, all_sk = _terms_matrix(terms, GRID, GRID, True, True)
        if all_sk:
            k_np, _ = _terms_matrix(terms, GRID, GRID, True, False)
            pairs.append((name, k_np, k_sk))
    # Circle-warped rbf with length scale l_w equals the periodic kernel with l_p = l_w / 2 (Notebook Code 66),
    # i.e. sklearn ExpSineSquared(length_scale=l_w, periodicity=T) times sigma^2.
    for name, terms in KERNEL_ENTRIES:
        f = terms[0][0]
        if len(terms) == 1 and len(terms[0]) == 1 and f.get("warp", {}).get("kind") == "circle":
            k_np, _ = _terms_matrix(terms, GRID, GRID, True, False)
            p, T = f["params"], f["warp"]["period"]
            sk = ConstantKernel(p["sigma"] ** 2, constant_value_bounds="fixed") * ExpSineSquared(
                p["ell"], T, length_scale_bounds="fixed", periodicity_bounds="fixed")
            pairs.append((name + " vs ExpSineSquared", k_np, sk(GRID[:, None])))
    return pairs


# ---------------------------------------------------------------- yacht

def build_yacht_split():
    train, test = train_test_split(np.arange(308), test_size=0.1, random_state=42)
    return {"meta": META, "train": train.tolist(), "test": test.tolist()}


def build_yacht_fixed():
    data = pd.read_csv(YACHT)
    X_org, y_org = data[["a1", "a2", "a3", "a4", "a5", "a6"]], data[["y"]]
    xT_org, xTest_org, yT_org, yTest_org = train_test_split(X_org, y_org, test_size=0.1, random_state=42)
    scaler_x = StandardScaler().fit(xT_org)
    scaler_y = StandardScaler().fit(yT_org)
    X_train, X_test = scaler_x.transform(xT_org), scaler_x.transform(xTest_org)
    y_train = scaler_y.transform(yT_org).flatten()
    y_test = yTest_org.values.flatten()

    gpr = GaussianProcessRegressor(
        kernel=RBF() * DotProduct() + WhiteKernel(), normalize_y=False, n_restarts_optimizer=5, random_state=0
    ).fit(X_train, y_train)
    k = gpr.kernel_
    ell, sigma0, white = float(k.k1.k1.length_scale), float(k.k1.k2.sigma_0), float(k.k2.noise_level)

    def cov(A, B):
        d2 = ((A[:, None, :] - B[None, :, :]) ** 2).sum(-1)
        return np.exp(-d2 / (2 * ell**2)) * (sigma0**2 + A @ B.T)

    sigma_n2 = white + 1e-10  # sklearn `alpha`
    K = cov(X_train, X_train)
    Ks = cov(X_test, X_train)
    Kss_diag = np.diag(cov(X_test, X_test))
    L = cholesky(K + sigma_n2 * np.eye(len(K)), lower=True)
    q = solve_triangular(L, y_train, lower=True)
    beta = solve_triangular(L.T, q, lower=False)
    V = solve_triangular(L, Ks.T, lower=True)
    pred_s = Ks @ beta
    var_f_s = Kss_diag - (V**2).sum(0)
    y_pred = scaler_y.inverse_transform(pred_s.reshape(-1, 1)).flatten()
    scale_y = float(scaler_y.scale_[0])
    y_std = np.sqrt(np.maximum(var_f_s, 0) + sigma_n2) * scale_y  # predictive sd of y (noise included)
    rmse = float(np.sqrt(np.mean((y_pred - y_test) ** 2)))

    sk_pred_s, sk_std_s = gpr.predict(X_test, return_std=True)
    return {
        "meta": META,
        "X_train": lst(X_train), "y_train": lst(y_train), "X_test": lst(X_test), "y_test": lst(y_test),
        "scaler_x_mean": lst(scaler_x.mean_), "scaler_x_scale": lst(scaler_x.scale_),
        "scaler_y_mean": float(scaler_y.mean_[0]), "scaler_y_scale": scale_y,
        "rbf_length_scale": ell, "dot_sigma_0": sigma0, "white_noise_level": white, "alpha": 1e-10,
        "y_test_pred": lst(y_pred), "y_test_std": lst(y_std), "logML": log_ml(L, q), "rmse": rmse,
        "sklearn_y_test_pred": lst(scaler_y.inverse_transform(sk_pred_s.reshape(-1, 1)).flatten()),
        "sklearn_y_test_std": lst(sk_std_s * scale_y),
    }


# ---------------------------------------------------------------- entry points

def build_all():
    return {
        "kap9": build_kap9(), "exercise5": build_exercise5(), "sine": build_sine(),
        "mean_demo": build_mean_demo(), "mean_fit": build_mean_fit(), "kernels": build_kernels(),
        "yacht_split": build_yacht_split(), "yacht_fixed": build_yacht_fixed(),
    }


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, obj in build_all().items():
        with open(OUT / f"{name}.json", "w", encoding="utf8", newline="\n") as f:
            json.dump(obj, f, separators=(",", ":"))
            f.write("\n")
        print("wrote", OUT / f"{name}.json")
