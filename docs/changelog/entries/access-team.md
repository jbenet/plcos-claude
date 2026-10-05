# The access level "GP" is now "Team", and the init file can deactivate · 5 Oct 2026

Juan, 5 Oct: "for access level, dont use `gp` then, use `team` maybe". On this team, GP is a real title: the GP
of a vehicle. So the access level meaning "a team member who reads and changes their vehicles" is now named
**Team**.
- Migration platform 020 renames the database value from `gp` to `team`. Every row keeps its access.
- The code, the People page ("Team"), the MCP and sync messages, and the init template follow.
- Titles stay in the free-text `role`, for example "PLC Team" or "GP, PLC Neurotech". Settings → People's default
  title for a new Team member is "PLC Team" instead of "General Partner".

The init file's team entries take `"active": false`. It deactivates the person, and migration 018's trigger
signs them out everywhere. Leaving `active` out keeps a person as they are.

A new property, on invented data, checks that deactivating through the file raises the session epoch, that
omitting `active` keeps the state, that a non-boolean `active` is refused, and that the access levels are exactly
admin, team and viewer.
