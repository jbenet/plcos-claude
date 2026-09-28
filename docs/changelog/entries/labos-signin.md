# LabOS sign-in — 28 Sep 2026

`LABOS_ME_URL` enables server-side `authToken` → Bearer `/me` identity lookup, cached by token hash for five minutes (100 entries). Tokens are never stored or logged. Missing cookies or a 401 show “Open Capital OS from LabOS → AI Apps”. The switcher is hidden and switching refused; without the env var, local behavior is unchanged.

Migration `013_labos_uid.sql` adds a nullable unique binding. Unknown UIDs get active viewers; existing roles and inactive accounts are preserved. An admin can bind an existing person with `UPDATE platform.app_user SET labos_uid = 'example-uid' WHERE handle = 'example';` before their first sign-in.

Validation: TypeScript, boundaries, and the PGlite property suite, including two new LabOS properties. Postgres runs at merge. Invented fixtures only.
