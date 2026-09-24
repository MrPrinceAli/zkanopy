# Contributing to ZKanopy

ZKanopy was built solo for the IEEE ClimateChain Global Hackathon 2026, but issues and pull requests are welcome.

## Before you start

- Check the [open issues](https://github.com/MrPrinceAli/zkanopy/issues) so we don't duplicate work.
- For anything bigger than a small fix, open an issue first so the approach can be agreed on.

## Setting up

Follow [Reproduce it](README.md#reproduce-it) in the README. The repository has four parts, each with its own tests:

| Part      | Where            | Tests                                   |
| --------- | ---------------- | --------------------------------------- |
| Circuits  | `circuits/`      | `npm test` from the repository root     |
| Contracts | `contracts/`     | `forge test -vv`                        |
| Oracle    | `oracle/`        | see the README (satellite data pipeline) |
| Frontend  | `frontend/`      | `npm test` (Vitest) and `npm run build` |

## Before opening a pull request

- Run the tests for every part you touched.
- Do not commit generated artefacts or secrets (proving keys, `frontend/public/zk/`, `.env`).
- Changing a circuit changes the verifier: regenerate the verifier contract and the proof fixtures, and say so in the PR.
- Keep pull requests focused: one change per PR. Describe **what** changed and **why**.
- User-facing text must be available in both English and Indonesian (`EN / ID` toggle).
