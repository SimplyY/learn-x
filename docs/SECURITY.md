# Security Policy

Learn-X may contain personal learning materials, but anything committed to this repository must be safe to open-source.

## Do Not Commit

- Private keys, certificates, wallet files, `.env*`, tokens, cookies, sessions, passwords, app secrets, API keys, or OAuth credentials.
- Raw personal privacy data, including ID numbers, phone numbers, bank card numbers, home addresses, chat logs, medical reports, or other directly identifying records.
- Files whose names imply secrets or credentials, such as `*token*`, `*secret*`, `*credential*`, `*password*`, `*cookie*`, `*session*`, or `*wallet*`.

If a private note is useful for learning, keep it outside this repository or commit only a clearly anonymized summary.

## Commit Guard

This repo uses a local pre-commit hook:

```bash
npm run security:scan:staged
```

The hook scans staged files only. It blocks common secret formats, sensitive filenames, and high-risk personal privacy patterns before commit.

For a fresh clone, run either command once:

```bash
npm install
```

or:

```bash
git config core.hooksPath .githooks
```

Do not bypass the hook with `--no-verify` to commit sensitive material. Remove or anonymize the data first, then stage and commit again.
