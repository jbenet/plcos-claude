{{common}}

Task: W1 search pass. Each LP in {{data}}/enrich/batches/{{batch}}.jsonl has a pages-only finding on file, owed a pass
with web search. Follow {{repo}}/docs/workflows/w1-profile.md exactly, its "The search pass" section in particular:
start from the finding on file and its "for the search pass" items, then search.
The finding on file is {{data}}/enrich/raw/<key>.json, or, when an alias maps to the key in
{{data}}/enrich/entity-keys.json, {{data}}/enrich/raw/<alias>.json. Revise that file in place, with
researched.method "search", and write no second file for the LP.
Examples of finished findings for shape: {{rawExamples}}.

Done when every LP in the batch has a revised finding (or a recorded reason the search found nothing more) and
enrich-check reports no problem for your keys. Final message: counts only (LPs, findings revised, identity changed,
nothing new, checker problems).
