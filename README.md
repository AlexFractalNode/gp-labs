# GP Labs

Interactive companion tools for **Notebook 10 *Gaussian Processes for Machine Learning*** and the accompanying
textbook *Gaußprozesse verstehen* of the course *Data Science 2* at WHZ (Westsächsische Hochschule Zwickau).

GP Labs is a static web app (Vue 3 + Vite + TypeScript) with three tools. It runs entirely in the browser: no
backend, no login, no installation. Every view has its own URL, so a specific setup can be shared as a link.
The interface is bilingual (German by default, English via the toggle or `?lang=en`).

The app does not reproduce the textbook. Its texts are written independently; references such as
"Lehrbuch Kap. 9 · Notebook Code 39" only point to where a topic is covered in the course materials.

## Tools and example links

Live site (after the first deployment): <https://alexfractalnode.github.io/gp-labs/>

| Tool | Route | What it shows | Example |
|---|---|---|---|
| GP Playground | `#/playground` | 1-D GP regression: click to add points, function and observation bands, samples, mean functions (incl. GLS), hyperparameter optimisation, an inspector for x* | `#/playground?preset=kap9&x=0` (one-point example of ch. 9) |
| Kernel Builder | `#/kernels` | Compose kernels from sums and products, prior samples that morph continuously, covariance heatmap, eigenvalue-based validity check, 2-D mode | `#/kernels?preset=power-exp` (raise p above 2) |
| Data Lab | `#/datalab` | The full workflow on real data in five steps (data, target, split, model, result), run comparison, "reproduce the notebook exactly" | `#/datalab` |

More presets: `#/playground?preset=sine`, `?preset=mean-demo`, `?preset=extrapolation`, `?preset=hyper`.
Prefix the routes with the site URL, e.g. `https://alexfractalnode.github.io/gp-labs/#/kernels?preset=power-exp`.
Invalid URL parameters fall back to a default view and show a notice.

## Local development

Requirements: Node 24 and npm. For the Python checks: [uv](https://docs.astral.sh/uv/) (it fetches Python 3.9 itself).

```sh
npm ci
npm run dev          # http://localhost:5175
npm run build        # type check (vue-tsc) + production build into dist/
npm run preview      # serve dist/ on http://localhost:4173
```

## Tests

```sh
npm run guard        # fails if course materials (.ipynb, .pdf, materials/) are tracked by git
npm test             # unit and golden tests (Vitest)
npm run test:py      # Python checks (pytest via uv): committed golden files match scripts/make_golden.py
npm run golden       # regenerate tests/golden/*.json from scripts/make_golden.py
```

End-to-end tests (Playwright) run against the production build, served by `vite preview` on port 4175. Install the
browser once, then run the suite:

```sh
npx playwright install chromium
npm run test:e2e
```

### What the golden tests prove, and what they do not

`scripts/make_golden.py` computes reference values in Python; the TypeScript core is checked against them in Vitest.

- **Posterior and likelihood:** the posterior, the log marginal likelihood and its gradient, GLS mean fitting and the
  yacht pipeline agree with NumPy/scikit-learn within tight tolerances (e.g. the ch. 9 one-point values
  0.8 / 0.447 / 0.671, the sine example of Code 17–42, the yacht split of
  `train_test_split(..., test_size=0.1, random_state=42)`).
- **Kernel matrices, sklearn-backed:** RBF, Matérn 3/2 and 5/2, exponential, rational quadratic, periodic, constant,
  white noise and two combinations are compared with the equivalent scikit-learn kernels.
- **Kernel matrices, transcriptions only:** the kernels of the notebook's PyMC gallery without an exact sklearn
  counterpart (cosine, linear with c ≠ 0, polynomial, Gibbs, power exponential, warped inputs) are compared with an
  explicit NumPy transcription of the PyMC formulas. These entries check the TypeScript code against the
  transcription, **not against PyMC itself**. There is no live PyMC comparison: PyMC is not a dependency, and the
  gallery is disabled in the notebook.
- **Optimisation:** the optimiser may find a different local optimum than sklearn. The yacht test therefore compares
  the achieved log marginal likelihood (at least sklearn's − 0.5) and the test RMSE (0.392 ± 0.05) instead of
  identical parameters.

### Why Python 3.9 and pinned versions

The Python checks pin Python 3.9, NumPy 1.26.4, SciPy 1.13.1, scikit-learn 1.6.1 and pandas 2.3.3. They match the
course's validated `requirements-core.txt`, so the reference values come from the same library versions the
notebook runs with.

## Deployment (GitHub Pages)

`.github/workflows/pages.yml` runs on every push to `main`: material guard, Python checks, unit tests, a build with
`BASE_PATH=/gp-labs/`, then the deployment of `dist/` to GitHub Pages via GitHub Actions.

One-time setup after the first push: in the repository, open **Settings → Pages → Build and deployment** and set
**Source: GitHub Actions**.

## Data

The Data Lab ships the *Yacht Hydrodynamics* data set (Gerritsma, J., Onnink, R., Versluis, A.) from the
UCI Machine Learning Repository, DOI [10.24432/C5XG7R](https://doi.org/10.24432/C5XG7R), licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Details: [`public/data/SOURCE.md`](public/data/SOURCE.md).

## Course materials

The textbook, the notebook and the slides of the course are **not** part of this repository and are never
committed. `npm run guard` and a CI step enforce this for `.ipynb`, `.pdf` and `materials/`.

## Licence

Code: [MIT](LICENSE). The yacht data keeps its own licence (CC BY 4.0, see above).
