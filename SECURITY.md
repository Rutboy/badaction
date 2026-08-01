# Security Policy

## Supported versions

Badaction does not currently maintain release branches. Security fixes are made
against the current `main` branch.

| Version or source state         | Security updates |
| ------------------------------- | ---------------- |
| Current `main`                  | Supported        |
| Earlier commits, tags, or forks | Not supported    |

Operators are responsible for tracking `main`, reviewing changes, applying
updates, and maintaining secure configuration for their own deployments.

## Report a vulnerability privately

Do not open a public issue, pull request, or discussion for a suspected
vulnerability. Use GitHub's private vulnerability reporting form for this
repository:

<https://github.com/Rutboy/badaction/security/advisories/new>

If that form is unavailable, private reporting has not been configured
correctly. Do not disclose technical details in a public issue or discussion;
retry after the maintainer enables the repository's private reporting form.

Include enough information to evaluate the report safely:

- the affected commit or version;
- impact and required preconditions;
- minimal reproduction steps or a safe proof of concept;
- relevant configuration, with secrets removed;
- a proposed mitigation, if known;
- your preferred attribution for any eventual disclosure.

Use synthetic data. Do not send production credentials, database dumps, visitor
cookies, user content, or raw invitation and owner-claim URLs. Redact connection
strings, internal hostnames, and personal data from logs and screenshots.

Reports are reviewed as maintainer capacity permits. This project does not
promise an acknowledgement, triage, remediation, or release service level. A
report may be closed if it is not reproducible, is outside the project scope, or
does not describe a security impact. Please keep details private while the
report is being evaluated and, when applicable, coordinate disclosure with the
maintainers.

## Research scope

Only test an instance you own or an environment for which you have explicit
authorization. Do not:

- access or modify another person's boards, credentials, or data;
- degrade service availability or perform denial-of-service testing;
- use social engineering, phishing, or physical attacks;
- scan third-party infrastructure without its owner's permission;
- retain more data than is necessary to demonstrate the issue.

Good-faith reports that minimize privacy and availability impact are welcome.

## Operational security

Self-hosters should follow the repository's deployment, configuration, backup,
upgrade, and retention documentation. Development secrets and Compose defaults
are not suitable for an externally accessible deployment. Rotate any credential
that may have been exposed; removing it from the current tree or adding it to
`.gitignore` does not remove it from Git history.
