-- The access level 'gp' becomes 'team' (Juan, 5 Oct 2026: "for access level, dont use `gp` then, use `team`
-- maybe"). "GP" is a real title on this team (the GP of a vehicle), so the access level that means "a team
-- member who reads and changes their vehicles" gets its own name. Existing rows keep their level; only the
-- label changes. Titles live in app_user.role, as before.
alter type platform.access_role rename value 'gp' to 'team';
