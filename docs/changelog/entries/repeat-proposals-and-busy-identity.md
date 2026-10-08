# Repeated identity proposals, and a clear "busy" while a merge runs · 8 Oct 2026

Issue 0138. Two Mac sessions each pushed the same retype and merge for the accelerator group. The two copies had
different evidence wording, so they had different fingerprints, and every copy was refused as a conflicting
proposal. Now identical decisions (same group, kind, members, survivor or new type) never conflict. They are
tried in file order until one applies, and after that the others are reported as superseded by it.

Merge duplicate identities holds the identity tables for its whole run, which takes minutes on the live server.
A retype or a review read sent during a run waited for 20 seconds and came back as "statement timeout" or a bare
500. Both now stop waiting after 5 seconds and answer 409, saying a merge or import is running and that nothing
was changed.
