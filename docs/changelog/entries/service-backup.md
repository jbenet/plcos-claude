# Service backup — encrypted S3 archives

The service timer can run a 40-line Bash backup: verify a custom-format Postgres dump,
encrypt it and the working-file tar with an offline-held key's public half, and upload to S3.
Working files exclude database clusters and backups. S3 thinning reuses the Mac retention
policy through `backup-prune.py --list-stdin`; the Mac backup command is unchanged.
The runtime adds the Postgres 17 client from [PGDG](https://www.postgresql.org/download/linux/debian/), GPG and awscli. Rev 3 documents setup.

Validation: typecheck and boundaries passed; two added properties exercise S3 retention
and refusal before encryption/upload for a dump with no TABLE DATA. All 1,126 properties passed;
Bash syntax and diff whitespace checks also passed.
The requested dry run against invented Postgres at 127.0.0.1:5434 was blocked by the sandbox
(`Operation not permitted`). Temporary test-key generation was also blocked by GPG agent IPC.
Docker is unavailable here; the image was not built. No real data or AWS calls were used.
