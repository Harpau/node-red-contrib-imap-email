# Security Policy

This policy applies to the npm package `@compeso/node-red-contrib-imap-email`
and to this repository.

## Supported versions

Security fixes are published for the current release on npm (dist-tag
`latest`). Older releases receive no backports; upgrade to the current release
before reporting an issue that a newer release may already address.

| Version | Supported |
| --- | --- |
| Current `latest` release | Yes |
| Older releases | No |

## Reporting a vulnerability

Do not open a public issue or pull request for a suspected vulnerability.

Report it privately through GitHub: open the repository's **Security** tab and
choose **Report a vulnerability**, or use
<https://github.com/Harpau/node-red-contrib-imap-email/security/advisories/new>.
The report stays private between you and the maintainer until a fix is
available.

Please include, as far as possible:

- The package version, Node-RED version and Node.js version.
- The node type involved: `imap-email account`, `imap-email in` or
  `imap-email ack`.
- Steps to reproduce against a synthetic or dedicated test mailbox.
- The impact you see, for example credential or token exposure, mail content in
  logs, unconfirmed ACK success, silent mail loss or an unbounded operation
  against a large mailbox.

Never include real passwords, OAuth tokens, private hostnames, raw mails or
attachments. Share flow excerpts only with credentials removed and describe
mail content anonymously.

## What to expect

- The maintainer aims to acknowledge a report within 14 days. This is a
  volunteer-maintained project; please allow for delays.
- Confirmed issues are fixed in a new release on npm with a GitHub release and
  a CHANGELOG entry. The advisory is published after the fix is available.
- Dependency advisories in the production dependencies (ImapFlow, Mailparser
  and their transitive packages) are tracked with Dependabot security updates
  and `npm audit --omit=dev` in CI. Consumers with their own lockfile may also
  need to refresh transitive dependencies, for example with `npm audit fix`.

## Security-relevant behavior of the package

- Credentials are stored in the Node-RED credential store. Passwords, tokens,
  raw mails and attachments are never logged.
- IMAP access is bounded: no mailbox-wide `SEARCH` or `FETCH 1:*`.
- ACK actions fail closed. `delete` requires `UIDPLUS` and a confirmed
  bounded removal; `move` requires the native `MOVE` capability.

Known limits of the current protections are documented in
[docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).
