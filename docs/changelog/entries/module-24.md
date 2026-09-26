## Module 24 (the other half) — claims and solicitation registry

**Shipped.** The compliance half of module 24 — the hole `docs/13-synthesis-r3.md` §2 names
explicitly: *"Across twenty modules and six architecture documents there is no
accredited-investor handling, no jurisdictional restriction, no solicitation record. For
506(c) vehicles that is not a simplification, it is a hole."*

![Compliance registry](docs/changelog/shots/m24/01-compliance.webp)

### It is a gate, not a report

`accreditationGate(entity, vehicle)` runs **before** a `MONEY` ticket is opened and again
inside the transaction that would record the hardening. A missing record is refused rather
than waved through — permitted-by-omission is the failure mode a verification obligation
exists to prevent.

### Complete, signed, and still insufficient

Whitcomb Capital is the case worth staring at. The record is there. It is signed, dated and
marked `verified`. It is **not sufficient**, because the method is self-certification and
that is not reasonable steps under 506(c) no matter who signed it. Asking to harden that
commitment is refused before a ticket exists.

The same record on the 506(b) Halo SPV *is* sufficient, because 506(b) asks for a
reasonable belief rather than verification. The judgement is per-vehicle, and the row shows
its reasoning in a sentence rather than a colour.

### The claim that caught itself

One public claim is flagged **needs review**: *"Backed by a $60M first close"*, used in an
email on 19 September. Hard is $56.0M until the Cedar `MONEY` ticket is approved. The
registry caught it because `substantiation` is a required column rather than a habit — the
person filing it had to write down what made it true, and could not.

### Side letters that interact

The Cedar fee break triggers the Vantage MFN, and Vantage has not been told. That is a row
here in September rather than a discovery in January.

Four new properties, including the one that matters:

```
  ok   Self-certification never satisfies a 506(c) vehicle
  ok   No 506(b) vehicle appears in the solicitation log
  ok   Every public claim in use has substantiation on file
  ok   Variation — harden a subscriber who only self-certified
       refused before a MONEY ticket was opened — the record is complete and still insufficient
```

`npm run props` is at **33 of 33**.

### Where I disagreed

**This should have been in the L-series, not after it.** The plan puts module 24 in the
"Execute & govern" section and L3 builds the ticket queue half, but nothing in L1–L13
builds the verification gate — and the gate is what makes four 506(c) vehicles safe to
operate. It took about half a day. If the L-series were being re-planned, this belongs
inside L6, next to the money it guards.

---
