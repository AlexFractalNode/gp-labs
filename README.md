# GP Labs

Interactive Gaussian-process teaching tools (Vue 3 + Vite + TypeScript). Work in progress.

## Development

```sh
npm install
npm run dev          # http://localhost:5175
npm test             # unit tests (Vitest)
npm run build        # type check + production build
```

### End-to-end tests (Playwright)

Install the browser once, then run the suite (it builds the app and serves it with `vite preview` on port 4175):

```sh
npx playwright install chromium
npm run test:e2e
```
