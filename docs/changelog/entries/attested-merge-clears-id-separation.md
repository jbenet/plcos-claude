# An attested merge clears the import's own "different ID" separation · 8 Oct 2026

Issue 0138. The accelerator's six duplicate records were held apart by two `different_external_id` separations.
The import records one whenever two records carry different Affinity (or warehouse, Dakota, findings) IDs. Nobody
decided these. The rule just declines to assume that two upstream records are one, and W13 said no decision could
override them. Juan ruled on 8 Oct that we apply duplicate merges ourselves ("ideally you do it / figure it out").

A W13 merge now clears such a separation when it attests every pair of differing IDs ("Same real organization:
affinity:X = affinity:Y") along with a supporting excerpt, which the merge already required for those IDs. The
separation is marked undone, its undo reason names the decision, and the merge applies. A separation a person or a
review recorded, or a reversed merge, still refuses. Two new identity-review properties cover both cases.
