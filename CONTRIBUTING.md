# Contributing to DeReddit

Thank you for helping improve DeReddit.

## Before making a change

- Search the [issue tracker](https://github.com/volitum/dereddit/issues) for an
  existing report or proposal.
- Open an issue before starting a large behavioral or architectural change.
- Use English for code, comments, commit messages, documentation, and UI text.
- Never commit credentials, personal data, browser profiles, exported settings,
  or generated release archives.

## Development workflow

DeReddit has no runtime or npm package dependencies. Node.js 20 or newer and
Python 3 are required for the default workflow.

```bash
npm test
npm run check
npm run build
```

The browser integration tests require Selenium and local Firefox or Chrome
binaries. See the browser-test instructions in [README.md](README.md).

Keep changes focused and add regression coverage for behavior changes. Before
opening a pull request, verify that:

- unit tests and source validation pass;
- both release archives build successfully;
- `git diff --check` reports no whitespace errors;
- affected behavior has been checked in Firefox and Chrome when practical;

## Reporting bugs

Include the DeReddit version, browser and version, Reddit layout, relevant
settings, expected result, and actual result. Remove usernames, subreddit lists,
cookies, tokens, and other private information before attaching screenshots or
configuration files.