# Support

Badaction is a self-hosted open source project. Maintainer support is provided
on a best-effort basis; there is no guaranteed response time, resolution time,
or private operational support channel.

## Before asking for help

Check the [README](./README.md) and [project documentation](./docs/README.md),
including the setup, deployment, configuration, operations, and troubleshooting
guidance. Search existing issues for the same symptoms before opening a new one.

Do not post credentials, database connection strings, visitor cookies, raw
invitation or owner-claim URLs, user content, or unredacted production logs.

## Where to report

### Reproducible software defects

Use the
[bug report form](https://github.com/Rutboy/badaction/issues/new?template=bug_report.yml)
when Badaction behaves differently from its documented or expected behavior.
Include the commit or version, deployment method, environment, minimal
reproduction steps, expected result, actual result, and sanitized logs when
relevant.

### Feature requests

Use the
[feature request form](https://github.com/Rutboy/badaction/issues/new?template=feature_request.yml)
for a new capability or a change to existing behavior. Describe the underlying
problem and use case rather than only a proposed implementation. Submitting a
request does not place it on a roadmap or guarantee implementation.

### Security vulnerabilities

Follow [SECURITY.md](./SECURITY.md) and report privately. Never disclose
vulnerability details in a public issue or pull request.

### Deployment and operational questions

First use the deployment, configuration, operations, and troubleshooting
documentation. If the documented procedure is incorrect or the software fails
reproducibly, file a bug report with a minimal, sanitized configuration. General
infrastructure administration, custom integrations, and debugging of unrelated
third-party services are outside the project's support scope.

## What makes a useful report

Reduce the problem to the smallest reproducible example and clearly distinguish
observed facts from assumptions. Provide text logs instead of screenshots where
possible, but remove secrets and personal data. Maintainers may close reports
that cannot be reproduced, concern an unsupported fork or modified deployment,
or do not contain enough information to act safely.
