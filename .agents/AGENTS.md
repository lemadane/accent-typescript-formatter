# Agent Behavioral Guidelines

## Test-Driven Development (TDD) Workflow
- For any new feature request, bug fix, or formatting rule modification:
  1. Write/create an End-to-End (E2E) test case in `src/test/suite/extension.e2e.test.ts` first that reproduces the issue or defines the expected formatting behavior.
  2. Implement the feature or fix in the codebase to make the E2E test pass.
  3. Verify with `npm run compile` and `npm test` before packaging and finalizing.
