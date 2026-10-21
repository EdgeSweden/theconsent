# Security policy

## Supported versions

Only the latest released minor version receives fixes.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's "Report a vulnerability" form on the
repository's Security tab rather than in a public issue. Include the affected version, a minimal
config that reproduces the problem and the browser used.

Areas of particular interest:

- anything that sets a cookie, touches storage or makes a request before the visitor has chosen;
- anything that breaks under a strict Content Security Policy or requires `'unsafe-inline'`;
- HTML or script injection through config strings.

You will receive an acknowledgement within a week. Fixes are released as a new patch version.
