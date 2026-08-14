# Fixtures (S01-T7)

Committed .docx binaries authored by `scripts/make-fixtures.ts`,
`scripts/make-perf-fixture.ts` and `scripts/make-isolation-fixture.ts` (run via `npx tsx`).
Authoring uses fflate + hand-authored OOXML — **never the reader** — and is fully
deterministic (R008/R017): pinned DOS timestamps, fixed entry order, no clock/random.
Re-running the scripts rewrites byte-identical files.

## Golden anchor

`minimal.docx` is the golden/determinism anchor with hand-known offsets:

| block | text | note |
|-------|------|------|
| 0 (heading, style Heading1) | `Introduction` | exercises styles.xml style-map path |
| 1 (paragraph) | `Smith (2024) proposed a theory` | citation `Smith (2024)` at `[0,12)` in paragraph text |
| 2 (paragraph) | `Fragmented run text here.` | fragmented runs, coalesced; runs at `[0,11)` `[11,20)` `[20,25)` |

## Corpus (author-date)

| fixture | purpose |
|---------|---------|
| `author-date/simple.docx` | APA-like simple citations + footnote |
| `author-date/et-al.docx` | et-al + multiple authors + Zotero CSL field marker |
| `author-date/multiple-authors.docx` | 3+ author spellings |
| `author-date/same-author-year.docx` | 2020a/2020b disambiguation |
| `author-date/missing.docx` | missing year/author edge cases |
| `author-date/ambiguous.docx` | ambiguous same-name citations |
| `author-date/vietnamese.docx` | Vietnamese thesis with diacritics + footnote |

## Corpus (documents/docx mirrors)

| fixture | purpose |
|---------|---------|
| `documents/docx/apa-like.docx` | narrative + parenthetical citations + reference list |
| `documents/docx/harvard.docx` | Harvard variants, page-number citation, entity-encoded text |
| `documents/docx/plain-text.docx` | plain-text citations, no structured fields |

## Corpus (bibliography)

| fixture | purpose |
|---------|---------|
| `bibliography/en-references.docx` | English true-positive: `References` heading + reference-list entries (high confidence) |
| `bibliography/vi-tai-lieu.docx` | Vietnamese true-positive: `Danh mục tài liệu tham khảo` heading + diacritic entries |
| `bibliography/style-position.docx` | custom heading text via Heading1 style + late position + reference-like entries (weighted-signal path, no exact text) |
| `bibliography/no-bibliography.docx` | narrative only, no heading/reference segment -> outcome `none` |
| `bibliography/ambiguous.docx` | `References` heading but non-reference-like short paragraphs following -> below-threshold/ask-user path |

## Corpus (match — S04 §25/§26/§27 benchmark calibration)

| fixture | purpose |
|---------|---------|
| `match/same-author-two-years.docx` | same author, two years: a `Doe (2018)` citation matches the 2018 entry (score 1.0) but scores 0.6 (< MATCH_THRESHOLD 0.7) against the 2021 entry — a wrong-year pairing can never be MATCHED (§79) |
| `match/ambiguous-same-author-year.docx` | one citation, TWO entries sharing author AND year (two distinct Smith, J. 2020 works) -> AMBIGUOUS, never auto-pick (§27/§31 CS004) |
| `match/near-miss-author.docx` | citation `Smith, J. (2019)` vs entry `Smith, P. (2019)` — same surname, CONTRADICTING given initial -> POSSIBLE_MISMATCH (0.525), never a confident MATCHED (§79) |
| `match/near-miss-vietnamese.docx` | Nguyễn/Nguyen reaches the §25 diacritic-insensitive tier-3 signal (0.845, reported — never promoted over exact) while Đỗ/Do stays DISTINCT (tier 5, 0.6 -> POSSIBLE_MISMATCH, §24/MEM037) |

## Corpus (numeric — M002-S01 D016 bracketed citation family)

| fixture | purpose |
|---------|---------|
| `numeric/basic.docx` | `[1]` and `[1,2]` resolve by ordered index to entries r0/r1 (D016, never author/year scoring) |
| `numeric/ranges.docx` | `[1-4]` and `[1,2,4-5]` ranges expand per-index (4 and 5 bindings, D016) |
| `numeric/multiple-brackets.docx` | multiple adjacent brackets `[1][2,3]` plus a trailing `[4]` — distinct regions (§20) |
| `numeric/out-of-range.docx` | resolved `[1]` beside out-of-range `[5]` and unmatched `[0]` — conservative surface, never silently guessed (§79) |
| `numeric/malformed.docx` | clean `[3]` emits while malformed `[1, x]` NEVER half-emits (R007, invalid-numeric surface for CS007 in S2) |

## Corpus (perf — M004-S01 load artifact)

`perf/100-page.docx` is a deterministic **load artifact** for the M004-S01
performance proof — the same document drives the `benchmark:perf` harness
(T2/T4), the Playwright large-doc spec (T5) and the S03 corpus sizing. It is
NOT a quality-corpus case: it joins `VALID_FIXTURES` and the generic per-
fixture assertions in `packages/docx/tests/fixture.test.ts` only, and is
deliberately absent from `scripts/fixture-ground-truth*.ts` (MEM065 atomicity
applies to the quality corpus only).

Regenerate with:

```
npx tsx scripts/make-perf-fixture.ts
```

The generator self-checks byte-identity (R017: build twice in memory, plus a
re-run after commit must leave `fixtures/perf` byte-identical).

Documented counts (measured from the committed file — the "100 pages" claim is
checkable):

| count | value |
|-------|-------|
| file size | 120,099 bytes |
| `word/document.xml` | 503,320 chars (well under the 1M design bound and the `limits.ts` caps) |
| body paragraphs | 900 (10 chapters x 90) |
| words | 53,507 (~107 pages at ~500 words/page) |
| authored citation strings | 2,695 (2,435 body + 260 reference-entry tails) |
| pipeline citation occurrences | 2,335 (extractor view; used by the matcher hot path) |
| reference entries | 260 (detected `References` section) |
| footnotes | 30 (note-scanning path) |
| tables | 3 (table-flattening path) |
| Zotero CSL fields | 6 (structured-field path) |
| Heading1 paragraphs | 11 (`Chapter 1..10` + `References`) — styles.xml style-map path |

Content structure: every body paragraph carries 2-3 realistic author-date
citations drawn from the same 260-author pool as the reference list (so
citations find real matching entries); the `KNOWN_CITATIONS` strings
(`Smith (2020)`, `(Nguyen & Tran, 2021)`) are authored verbatim in Chapter 1's
first body paragraph so the `fixture.test.ts` offset round-trip holds.

## Corpus (isolation — M004-S02 failure-isolation demo)

`isolation/garbage-and-malformed.docx` is the deterministic **failure-isolation
demo** for the R016 hardening proof: ONE document carries BOTH typed issue
classes the S02 demo surfaces through the public `lintDocument` — a garbage
reference entry (`Junk without a year.` → CS006 reference-parse) and a
malformed bracket (`[1, x]` → CS007 invalid-numeric `mixed`) — beside a clean
`[1]` that binds positionally to `r0` (the garbage entry itself: even a
garbage entry never crashes the analysis) and 2 valid entries
(`Doe, J. (2017).`, `Roe, M. (2018).`) so bibliography detection and D016
matching really run.

It is NOT a quality-corpus case: it joins `VALID_FIXTURES` and the generic
per-fixture assertions in `packages/docx/tests/fixture.test.ts` plus the
numeric ground-truth locks (`KNOWN_NUMERIC_INDEX_MAP` +
`packages/docx/tests/numeric-fixture.test.ts`) so the
malformed-bracket-never-persisted invariant (R007/MEM092) stays guarded — the
MEM065 atomicity carve-out applies to the S03 quality corpus only.

Regenerate with:

```
npx tsx scripts/make-isolation-fixture.ts
```

The generator self-checks byte-identity (R017: build twice in memory, plus a
re-run after commit must leave `fixtures/isolation` byte-identical).

Documented counts (measured from the committed file — the demo surface is
checkable):

| count | value |
|-------|-------|
| file size | 2,664 bytes |
| `word/document.xml` | 719 chars |
| blocks | 6 (2 body paragraphs + 1 `References` Heading1 + 3 reference entries) |
| reference entries | 3 (1 garbage → CS006, 2 valid → bibliography detected + D016 matching runs) |
| expected typed issues | CS006 x1 (reference-parse) + CS007 x1 (invalid-numeric `mixed`) |

## Corpus (quality — M004-S03 R017 gate corpus)

`quality/medium.docx` is a deterministic **synthetic quality-corpus fixture**
giving the R017 quality gates (detection precision >= 0.98 / recall >= 0.95 /
matching precision >= 0.97, FP = 0, asserted by `packages/core/tests/
quality-gates.test.ts`) real statistical weight: the hand corpus (~92
expected raws / 39 MATCHED rows) has almost no headroom — 2 wrong
detections drop precision to 97.8% (< 98%) — so a single wrong regression
flips a gate. This fixture's 340 raws are 100%-authored ground truth, so a
wrong regression must now fail against ~10x the evidence.

It carries its OWN generated manifest
(`scripts/fixture-ground-truth-quality.ts`, emitted byte-for-byte by the
generator) and joins NO ground-truth manifests (`KNOWN_OCCURRENCES` /
`KNOWN_REFERENCES` / `KNOWN_MATCHES` / `KNOWN_NUMERIC_INDEX_MAP`) and NO
numeric locks — the MEM065/MEM165 atomicity carve-out applies to the S03
quality corpus only. Content contract: 60 single-author entries with UNIQUE
(family, year) keys (no CS004/CS005), every entry cited >= 1x (no
CS001/CS002/CS009), all entries §21-parseable at confidence 1 (no CS006),
no numeric content (no CS007/CS008) → zero expected issues.

Regenerate with:

```
npx tsx scripts/make-quality-fixture.ts
```

The generator self-checks byte-identity for BOTH the fixture and the
manifest (R017: build twice in memory, plus a re-run after commit must leave
both files byte-identical). The `KNOWN_CITATIONS` anchors (`Smith (2020)`
narrative, `(Nguyen, 2021)` parenthetical — single-author; a documented
deviation from the perf fixture's multi-author anchor) are authored verbatim
in body paragraph 1 so the `fixture.test.ts` offset round-trip holds.

Documented counts (measured from the committed file — the corpus claim is
checkable):

| count | value |
|-------|-------|
| file size | 7,487 bytes |
| `word/document.xml` | 29,279 chars |
| blocks | 101 (40 body + 1 `References` Heading1 + 60 reference entries) |
| body paragraphs | 40 x 7 citations = 280 body citations |
| words | 2,694 |
| reference entries | 60 (unique (family, year) keys, all §21-parseable) |
| total expected raws | 340 (280 body + 60 entry tails) |
| expected issues | 0 (all-zero — unique keys, full coverage, clean parse, no numeric) |

## Security samples

| fixture | expected reader behavior |
|---------|--------------------------|
| `security/zip-bomb.docx` | entry declares 60 MiB (> DOCX_ENTRY_MAX) -> `ZipBombError` before inflate |
| `security/lying-bomb.docx` | entry declares 100 B but inflates to 60 MiB (lying declaration) -> `ZipBombError` on actual output (S01-T9) |
| `security/truncated.docx` | central directory + EOCD removed -> `NotADocxError` (truncated ZIP) |
| `security/not-a-docx.zip` | well-formed ZIP, missing required parts -> `NotADocxError` |
| `security/garbage.docx` | non-ZIP bytes -> `NotADocxError` (no PK magic) |
| `security/vba-sample.docx` | **valid** docx + `word/vbaProject.bin` + external rel targets; parses fine, macro/remote targets only noted |

> `security/vba-sample.docx` is a VALID package (macro parts are note-and-skip, never
> executed or decoded). Only the five explicitly "bad" samples are expected to throw
> typed errors from the reader.

## S03 extraction ground truth (KNOWN_CITATIONS / KNOWN_REFERENCES)

The §20 citation occurrences and §21 reference entries the S03 pipeline must produce
per fixture — single source of truth: `scripts/fixture-ground-truth.ts`, asserted
byte-stably by `packages/docx/tests/extraction.test.ts` (any change to fixture
bytes, the model shape, the grammar or the normalization drifts these tables).

### minimal.docx

- `c0` `Smith (2024)` @ `doc-p1[0,12)` author-date conf 0.9 → {"firstAuthor":"Smith","authors":["Smith"],"year":2024}

### author-date/simple.docx

- `c0` `Smith (2020)` @ `doc-p1[0,12)` author-date conf 0.9 → {"firstAuthor":"Smith","authors":["Smith"],"year":2020}
- `c1` `(Nguyen & Tran, 2021)` @ `doc-p2[12,33)` author-date conf 0.93 → {"firstAuthor":"Nguyen","authors":["Nguyen","Tran"],"year":2021}
- `c2` `(Lee, 2019)` @ `doc-p3[14,25)` author-date conf 1 → {"firstAuthor":"Lee","authors":["Lee"],"year":2019}
- `c3` `Smith (2020)` @ `fn-fn0[0,12)` author-date conf 0.9 → {"firstAuthor":"Smith","authors":["Smith"],"year":2020}

### author-date/et-al.docx

- `c0` `(Nguyen et al., 2019)` @ `doc-p1[12,33)` author-date conf 1 → {"firstAuthor":"Nguyen","authors":["Nguyen H.","Tran L."],"year":2019}
- `c1` `Anderson, Brown, and Clark (2018)` @ `doc-p2[0,33)` author-date conf 0.837 → {"firstAuthor":"Anderson","authors":["Anderson","Brown","Clark"],"year":2018}
- `c2` `(Williams et al., 2022)` @ `doc-p3[13,36)` author-date conf 0.9 → {"firstAuthor":"Williams","authors":["Williams","et al."],"year":2022}
- `c3` `Nguyen et al. (2019)` @ `fn-fn0[0,20)` author-date conf 0.81 → {"firstAuthor":"Nguyen","authors":["Nguyen et al."],"year":2019}

### author-date/multiple-authors.docx

- `c0` `(Duong, Tran, & Le, 2020)` @ `doc-p0[0,25)` author-date conf 0.93 → {"firstAuthor":"Duong","authors":["Duong","Tran","Le"],"year":2020}
- `c1` `Pham and Nguyen (2017)` @ `doc-p1[0,22)` author-date conf 0.837 → {"firstAuthor":"Pham","authors":["Pham","Nguyen"],"year":2017}
- `c2` `Ngo, Vu, Hoang, and Bui (2016)` @ `doc-p2[0,30)` author-date conf 0.837 → {"firstAuthor":"Ngo","authors":["Ngo","Vu","Hoang","Bui"],"year":2016}

### author-date/same-author-year.docx

- `c0` `Smith (2020a)` @ `doc-p0[0,13)` author-date conf 0.855 → {"firstAuthor":"Smith","authors":["Smith"],"year":2020,"yearSuffix":"a"}
- `c1` `Smith (2020b)` @ `doc-p0[35,48)` author-date conf 0.855 → {"firstAuthor":"Smith","authors":["Smith"],"year":2020,"yearSuffix":"b"}
- `c2` `(Smith, 2020a; Smith, 2020b)` @ `doc-p1[0,28)` author-date conf 0.855 → {"firstAuthor":"Smith","authors":["Smith"],"year":2020,"yearSuffix":"a"} ; {"firstAuthor":"Smith","authors":["Smith"],"year":2020,"yearSuffix":"b"}

### author-date/missing.docx

- `c0` `(n.d.)` @ `doc-p0[22,28)` author-date conf 0.385 → {}
- `c1` `(Author unknown, n.d.)` @ `doc-p1[0,22)` author-date conf 0.651 → {"firstAuthor":"Author","authors":["Author","unknown"]}

### author-date/ambiguous.docx

- `c0` `(Smith, 2020)` @ `doc-p0[0,13)` author-date conf 1 → {"firstAuthor":"Smith","authors":["Smith"],"year":2020}
- `c1` `Smith (2020)` @ `doc-p1[0,12)` author-date conf 0.9 → {"firstAuthor":"Smith","authors":["Smith"],"year":2020}

### author-date/vietnamese.docx

- `c0` `Nguyễn Văn A (2015)` @ `doc-p1[5,24)` author-date conf 0.9 → {"firstAuthor":"Nguyễn","authors":["Nguyễn Văn A"],"year":2015}
- `c1` `Trần Thị B (2018)` @ `doc-p2[15,32)` author-date conf 0.9 → {"firstAuthor":"Trần","authors":["Trần Thị B"],"year":2018}
- `c2` `Phạm Quốc C (2020)` @ `doc-p3[20,38)` author-date conf 0.9 → {"firstAuthor":"Phạm","authors":["Phạm Quốc C"],"year":2020}
- `c3` `Nguyễn Văn A (2015)` @ `fn-fn0[9,28)` author-date conf 0.9 → {"firstAuthor":"Nguyễn","authors":["Nguyễn Văn A"],"year":2015}

### documents/docx/apa-like.docx

- `c0` `Johnson (2018)` @ `doc-p1[13,27)` author-date conf 0.9 → {"firstAuthor":"Johnson","authors":["Johnson"],"year":2018}
- `c1` `(Doe, 2017; Roe, 2019)` @ `doc-p2[17,39)` author-date conf 0.9 → {"firstAuthor":"Doe","authors":["Doe"],"year":2017} ; {"firstAuthor":"Roe","authors":["Roe"],"year":2019}
- `c2` `Doe, J. (2017)` @ `doc-p3[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2017}
- `c3` `Johnson, A. (2018)` @ `doc-p4[0,18)` author-date conf 0.9 → {"firstAuthor":"Johnson","authors":["Johnson"],"year":2018}
- `c4` `Roe, M. (2019)` @ `doc-p5[0,14)` author-date conf 0.837 → {"firstAuthor":"Roe","authors":["Roe","M."],"year":2019}

### documents/docx/harvard.docx

- `c0` `(Smith, 2024, p. 12)` @ `doc-p0[17,37)` author-date conf 0.97 → {"firstAuthor":"Smith","authors":["Smith"],"year":2024,"page":"12"}
- `c1` `(Nguyen 2021)` @ `doc-p1[14,27)` author-date conf 0.85 → {"firstAuthor":"Nguyen","authors":["Nguyen"],"year":2021}
- `c2` `Le (2023)` @ `doc-p2[32,41)` author-date conf 0.9 → {"firstAuthor":"Le","authors":["Le"],"year":2023}

### documents/docx/plain-text.docx

- `c0` `(Johnson 2018)` @ `doc-p0[21,35)` author-date conf 0.85 → {"firstAuthor":"Johnson","authors":["Johnson"],"year":2018}
- `c1` `[1]` @ `doc-p1[9,12)` numeric conf 1 → {"numbers":[1]}

### bibliography/en-references.docx

- `c0` `Doe (2017)` @ `doc-p1[0,10)` author-date conf 0.9 → {"firstAuthor":"Doe","authors":["Doe"],"year":2017}
- `c1` `Johnson (2018)` @ `doc-p2[0,14)` author-date conf 0.9 → {"firstAuthor":"Johnson","authors":["Johnson"],"year":2018}
- `c2` `Roe (2019)` @ `doc-p3[0,10)` author-date conf 0.9 → {"firstAuthor":"Roe","authors":["Roe"],"year":2019}
- `c3` `Doe, J. (2017)` @ `doc-p5[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2017}
- `c4` `Johnson, A. (2018)` @ `doc-p6[0,18)` author-date conf 0.9 → {"firstAuthor":"Johnson","authors":["Johnson"],"year":2018}
- `c5` `Roe, M. (2019)` @ `doc-p7[0,14)` author-date conf 0.837 → {"firstAuthor":"Roe","authors":["Roe","M."],"year":2019}

### bibliography/vi-tai-lieu.docx

- `c0` `Nguyễn, V. A. (2015)` @ `doc-p1[0,20)` author-date conf 0.837 → {"firstAuthor":"Nguyễn","authors":["Nguyễn","V. A."],"year":2015}
- `c1` `Trần, T. B. (2018)` @ `doc-p2[0,18)` author-date conf 0.837 → {"firstAuthor":"Trần","authors":["Trần","T. B."],"year":2018}
- `c2` `Phạm, Q. C. (2020)` @ `doc-p3[0,18)` author-date conf 0.837 → {"firstAuthor":"Phạm","authors":["Phạm","Q. C."],"year":2020}

### bibliography/style-position.docx

- `c0` `Nguyễn (2019)` @ `doc-p2[5,18)` author-date conf 0.9 → {"firstAuthor":"Nguyễn","authors":["Nguyễn"],"year":2019}
- `c1` `Doe, J. (2017)` @ `doc-p6[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2017}
- `c2` `Johnson, A. (2018)` @ `doc-p7[0,18)` author-date conf 0.9 → {"firstAuthor":"Johnson","authors":["Johnson"],"year":2018}
- `c3` `Roe, M. (2019)` @ `doc-p8[0,14)` author-date conf 0.837 → {"firstAuthor":"Roe","authors":["Roe","M."],"year":2019}

### bibliography/no-bibliography.docx

- `c0` `Smith (2020)` @ `doc-p1[0,12)` author-date conf 0.9 → {"firstAuthor":"Smith","authors":["Smith"],"year":2020}
- `c1` `(Nguyen & Tran, 2021)` @ `doc-p2[12,33)` author-date conf 0.93 → {"firstAuthor":"Nguyen","authors":["Nguyen","Tran"],"year":2021}

### bibliography/ambiguous.docx

- `c0` `(Doe, 2017)` @ `doc-p2[12,23)` author-date conf 1 → {"firstAuthor":"Doe","authors":["Doe"],"year":2017}

### match/same-author-two-years.docx

- `c0` `Doe (2018)` @ `doc-p1[0,10)` author-date conf 0.9 → {"firstAuthor":"Doe","authors":["Doe"],"year":2018}
- `c1` `(Doe, 2021)` @ `doc-p2[0,11)` author-date conf 1 → {"firstAuthor":"Doe","authors":["Doe"],"year":2021}
- `c2` `Doe, J. (2018)` @ `doc-p4[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2018}
- `c3` `Doe, J. (2021)` @ `doc-p5[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2021}

### match/ambiguous-same-author-year.docx

- `c0` `Smith (2020)` @ `doc-p1[0,12)` author-date conf 0.9 → {"firstAuthor":"Smith","authors":["Smith"],"year":2020}
- `c1` `Smith, J. (2020)` @ `doc-p3[0,16)` author-date conf 0.837 → {"firstAuthor":"Smith","authors":["Smith","J."],"year":2020}
- `c2` `Smith, J. (2020)` @ `doc-p4[0,16)` author-date conf 0.837 → {"firstAuthor":"Smith","authors":["Smith","J."],"year":2020}

### match/near-miss-author.docx

- `c0` `Smith, J. (2019)` @ `doc-p1[0,16)` author-date conf 0.837 → {"firstAuthor":"Smith","authors":["Smith","J."],"year":2019}
- `c1` `Smith, P. (2019)` @ `doc-p3[0,16)` author-date conf 0.837 → {"firstAuthor":"Smith","authors":["Smith","P."],"year":2019}
- `c2` `Roe, M. (2017)` @ `doc-p4[0,14)` author-date conf 0.837 → {"firstAuthor":"Roe","authors":["Roe","M."],"year":2017}

### match/near-miss-vietnamese.docx

- `c0` `Nguyễn, V. A. (2015)` @ `doc-p1[5,25)` author-date conf 0.837 → {"firstAuthor":"Nguyễn","authors":["Nguyễn","V. A."],"year":2015}
- `c1` `Đỗ (2018)` @ `doc-p2[0,9)` author-date conf 0.9 → {"firstAuthor":"Đỗ","authors":["Đỗ"],"year":2018}
- `c2` `Nguyen, V. A. (2015)` @ `doc-p4[0,20)` author-date conf 0.837 → {"firstAuthor":"Nguyen","authors":["Nguyen","V. A."],"year":2015}
- `c3` `Do, Q. (2018)` @ `doc-p5[0,13)` author-date conf 0.837 → {"firstAuthor":"Do","authors":["Do","Q."],"year":2018}

### numeric/basic.docx

- `c0` `[1]` @ `doc-p1[19,22)` numeric conf 1 → {"numbers":[1]}
- `c1` `[1,2]` @ `doc-p1[35,40)` numeric conf 0.97 → {"numbers":[1,2]}
- `c2` `Doe, J. (2017)` @ `doc-p3[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2017}
- `c3` `Roe, M. (2018)` @ `doc-p4[0,14)` author-date conf 0.837 → {"firstAuthor":"Roe","authors":["Roe","M."],"year":2018}
- `c4` `Lee, K. (2019)` @ `doc-p5[0,14)` author-date conf 0.837 → {"firstAuthor":"Lee","authors":["Lee","K."],"year":2019}

### numeric/ranges.docx

- `c0` `[1-4]` @ `doc-p1[14,19)` numeric conf 0.95 → {"numbers":[1,2,3,4]}
- `c1` `[1,2,4-5]` @ `doc-p1[40,49)` numeric conf 0.9215 → {"numbers":[1,2,4,5]}
- `c2` `Doe, J. (2017)` @ `doc-p3[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2017}
- `c3` `Roe, M. (2018)` @ `doc-p4[0,14)` author-date conf 0.837 → {"firstAuthor":"Roe","authors":["Roe","M."],"year":2018}
- `c4` `Lee, K. (2019)` @ `doc-p5[0,14)` author-date conf 0.837 → {"firstAuthor":"Lee","authors":["Lee","K."],"year":2019}
- `c5` `Tran, B. (2020)` @ `doc-p6[0,15)` author-date conf 0.837 → {"firstAuthor":"Tran","authors":["Tran","B."],"year":2020}
- `c6` `Nguyen, H. (2021)` @ `doc-p7[0,17)` author-date conf 0.837 → {"firstAuthor":"Nguyen","authors":["Nguyen","H."],"year":2021}

### numeric/multiple-brackets.docx

- `c0` `[1]` @ `doc-p1[18,21)` numeric conf 1 → {"numbers":[1]}
- `c1` `[2,3]` @ `doc-p1[21,26)` numeric conf 0.97 → {"numbers":[2,3]}
- `c2` `[4]` @ `doc-p1[47,50)` numeric conf 1 → {"numbers":[4]}
- `c3` `Doe, J. (2017)` @ `doc-p3[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2017}
- `c4` `Roe, M. (2018)` @ `doc-p4[0,14)` author-date conf 0.837 → {"firstAuthor":"Roe","authors":["Roe","M."],"year":2018}
- `c5` `Lee, K. (2019)` @ `doc-p5[0,14)` author-date conf 0.837 → {"firstAuthor":"Lee","authors":["Lee","K."],"year":2019}
- `c6` `Tran, B. (2020)` @ `doc-p6[0,15)` author-date conf 0.837 → {"firstAuthor":"Tran","authors":["Tran","B."],"year":2020}

### numeric/out-of-range.docx

- `c0` `[1]` @ `doc-p1[11,14)` numeric conf 1 → {"numbers":[1]}
- `c1` `[5]` @ `doc-p1[43,46)` numeric conf 1 → {"numbers":[5]}
- `c2` `[0]` @ `doc-p1[64,67)` numeric conf 1 → {"numbers":[0]}
- `c3` `Doe, J. (2017)` @ `doc-p3[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2017}
- `c4` `Roe, M. (2018)` @ `doc-p4[0,14)` author-date conf 0.837 → {"firstAuthor":"Roe","authors":["Roe","M."],"year":2018}
- `c5` `Lee, K. (2019)` @ `doc-p5[0,14)` author-date conf 0.837 → {"firstAuthor":"Lee","authors":["Lee","K."],"year":2019}

### numeric/malformed.docx

- `c0` `[3]` @ `doc-p1[8,11)` numeric conf 1 → {"numbers":[3]}
- `c1` `Doe, J. (2017)` @ `doc-p3[0,14)` author-date conf 0.837 → {"firstAuthor":"Doe","authors":["Doe","J."],"year":2017}
- `c2` `Roe, M. (2018)` @ `doc-p4[0,14)` author-date conf 0.837 → {"firstAuthor":"Roe","authors":["Roe","M."],"year":2018}
- `c3` `Lee, K. (2019)` @ `doc-p5[0,14)` author-date conf 0.837 → {"firstAuthor":"Lee","authors":["Lee","K."],"year":2019}

### security/vba-sample.docx

_no citations_

### documents/docx/apa-like.docx (references)

_detected section without entry blocks — parsing scope is exactly S02's blockIds_

### bibliography/en-references.docx (references)

- `r0` @ `doc-p5[0,98)` conf 1 → authors=[Doe, J.] year=2017 title="Citation practice in digital documents" container="Journal of Citation Science" identifiers={"volume":"12","issue":"3","pages":"45-60"}
- `r1` @ `doc-p6[0,69)` conf 0.9412 → authors=[Johnson, A.] year=2018 title="Structured citations" container="Cambridge University Press"
- `r2` @ `doc-p7[0,73)` conf 1 → authors=[Roe, M.] year=2019 title="Offsets and evidence" container="ACM Computing Surveys" identifiers={"volume":"51","issue":"2","pages":"1-30"}

### bibliography/vi-tai-lieu.docx (references)

- `r0` @ `doc-p1[0,113)` conf 0.9412 → authors=[Nguyễn, V. A.] year=2015 title="Phương pháp trích dẫn tự động trong văn bản khoa học" container="Nhà xuất bản Đại học Quốc gia Hà Nội"
- `r1` @ `doc-p2[0,109)` conf 1 → authors=[Trần, T. B.] year=2018 title="Cấu trúc trường trích dẫn trong tài liệu số" container="Tạp chí Khoa học và Công nghệ" identifiers={"volume":"12","issue":"2","pages":"33-47"}
- `r2` @ `doc-p3[0,98)` conf 0.9412 → authors=[Phạm, Q. C.] year=2020 title="Nhận dạng danh mục tài liệu tham khảo trong văn bản" container="Đại học Bách khoa Hà Nội"

### bibliography/style-position.docx (references)

- `r0` @ `doc-p6[0,98)` conf 1 → authors=[Doe, J.] year=2017 title="Citation practice in digital documents" container="Journal of Citation Science" identifiers={"volume":"12","issue":"3","pages":"45-60"}
- `r1` @ `doc-p7[0,69)` conf 0.9412 → authors=[Johnson, A.] year=2018 title="Structured citations" container="Cambridge University Press"
- `r2` @ `doc-p8[0,73)` conf 1 → authors=[Roe, M.] year=2019 title="Offsets and evidence" container="ACM Computing Surveys" identifiers={"volume":"51","issue":"2","pages":"1-30"}

### match/same-author-two-years.docx (references)

- `r0` @ `doc-p4[0,97)` conf 1 → authors=[Doe, J.] year=2018 title="Citation practices in digital archives" container="Journal of Citation Science" identifiers={"volume":"9","issue":"1","pages":"10-22"}
- `r1` @ `doc-p5[0,99)` conf 1 → authors=[Doe, J.] year=2021 title="Advances in digital citation analysis" container="Journal of Citation Science" identifiers={"volume":"12","issue":"4","pages":"100-115"}

### match/ambiguous-same-author-year.docx (references)

- `r0` @ `doc-p3[0,91)` conf 1 → authors=[Smith, J.] year=2020 title="First book on citation analysis" container="Journal of Citation Science" identifiers={"volume":"1","issue":"1","pages":"1-10"}
- `r1` @ `doc-p4[0,93)` conf 1 → authors=[Smith, J.] year=2020 title="Second book on citation analysis" container="Journal of Citation Science" identifiers={"volume":"1","issue":"2","pages":"11-20"}

### match/near-miss-author.docx (references)

- `r0` @ `doc-p3[0,105)` conf 1 → authors=[Smith, P.] year=2019 title="Citation persistence in digital repositories" container="Journal of Citation Science" identifiers={"volume":"5","issue":"2","pages":"30-44"}
- `r1` @ `doc-p4[0,83)` conf 1 → authors=[Roe, M.] year=2017 title="Repository archiving practices" container="ACM Computing Surveys" identifiers={"volume":"49","issue":"1","pages":"1-18"}

### match/near-miss-vietnamese.docx (references)

- `r0` @ `doc-p4[0,113)` conf 0.9412 → authors=[Nguyen, V. A.] year=2015 title="Phương pháp trích dẫn tự động trong văn bản khoa học" container="Nhà xuất bản Đại học Quốc gia Hà Nội"
- `r1` @ `doc-p5[0,93)` conf 1 → authors=[Do, Q.] year=2018 title="Cấu trúc dữ liệu trích dẫn có dấu" container="Tạp chí Khoa học và Công nghệ" identifiers={"volume":"10","issue":"1","pages":"5-15"}

### numeric/basic.docx (references)

- `r0` @ `doc-p3[0,98)` conf 1 → authors=[Doe, J.] year=2017 title="Citation practice in digital documents" container="Journal of Citation Science" identifiers={"volume":"12","issue":"3","pages":"45-60"}
- `r1` @ `doc-p4[0,92)` conf 1 → authors=[Roe, M.] year=2018 title="Evidence synthesis in citation analysis" container="ACM Computing Surveys" identifiers={"volume":"50","issue":"2","pages":"1-25"}
- `r2` @ `doc-p5[0,101)` conf 1 → authors=[Lee, K.] year=2019 title="Methodological notes on reference mapping" container="Journal of Citation Science" identifiers={"volume":"11","issue":"1","pages":"30-48"}

### numeric/ranges.docx (references)

- `r0` @ `doc-p3[0,98)` conf 1 → authors=[Doe, J.] year=2017 title="Citation practice in digital documents" container="Journal of Citation Science" identifiers={"volume":"12","issue":"3","pages":"45-60"}
- `r1` @ `doc-p4[0,92)` conf 1 → authors=[Roe, M.] year=2018 title="Evidence synthesis in citation analysis" container="ACM Computing Surveys" identifiers={"volume":"50","issue":"2","pages":"1-25"}
- `r2` @ `doc-p5[0,101)` conf 1 → authors=[Lee, K.] year=2019 title="Methodological notes on reference mapping" container="Journal of Citation Science" identifiers={"volume":"11","issue":"1","pages":"30-48"}
- `r3` @ `doc-p6[0,114)` conf 1 → authors=[Tran, B.] year=2020 title="Case studies in structured citation pipelines" container="IEEE Transactions on Documentation" identifiers={"volume":"14","issue":"2","pages":"90-110"}
- `r4` @ `doc-p7[0,92)` conf 0.9412 → authors=[Nguyen, H.] year=2021 title="Advances in deterministic document pipelines" container="Cambridge University Press"

### numeric/multiple-brackets.docx (references)

- `r0` @ `doc-p3[0,98)` conf 1 → authors=[Doe, J.] year=2017 title="Citation practice in digital documents" container="Journal of Citation Science" identifiers={"volume":"12","issue":"3","pages":"45-60"}
- `r1` @ `doc-p4[0,92)` conf 1 → authors=[Roe, M.] year=2018 title="Evidence synthesis in citation analysis" container="ACM Computing Surveys" identifiers={"volume":"50","issue":"2","pages":"1-25"}
- `r2` @ `doc-p5[0,101)` conf 1 → authors=[Lee, K.] year=2019 title="Methodological notes on reference mapping" container="Journal of Citation Science" identifiers={"volume":"11","issue":"1","pages":"30-48"}
- `r3` @ `doc-p6[0,114)` conf 1 → authors=[Tran, B.] year=2020 title="Case studies in structured citation pipelines" container="IEEE Transactions on Documentation" identifiers={"volume":"14","issue":"2","pages":"90-110"}

### numeric/out-of-range.docx (references)

- `r0` @ `doc-p3[0,98)` conf 1 → authors=[Doe, J.] year=2017 title="Citation practice in digital documents" container="Journal of Citation Science" identifiers={"volume":"12","issue":"3","pages":"45-60"}
- `r1` @ `doc-p4[0,92)` conf 1 → authors=[Roe, M.] year=2018 title="Evidence synthesis in citation analysis" container="ACM Computing Surveys" identifiers={"volume":"50","issue":"2","pages":"1-25"}
- `r2` @ `doc-p5[0,101)` conf 1 → authors=[Lee, K.] year=2019 title="Methodological notes on reference mapping" container="Journal of Citation Science" identifiers={"volume":"11","issue":"1","pages":"30-48"}

### numeric/malformed.docx (references)

- `r0` @ `doc-p3[0,98)` conf 1 → authors=[Doe, J.] year=2017 title="Citation practice in digital documents" container="Journal of Citation Science" identifiers={"volume":"12","issue":"3","pages":"45-60"}
- `r1` @ `doc-p4[0,92)` conf 1 → authors=[Roe, M.] year=2018 title="Evidence synthesis in citation analysis" container="ACM Computing Surveys" identifiers={"volume":"50","issue":"2","pages":"1-25"}
- `r2` @ `doc-p5[0,101)` conf 1 → authors=[Lee, K.] year=2019 title="Methodological notes on reference mapping" container="Journal of Citation Science" identifiers={"volume":"11","issue":"1","pages":"30-48"}

## S04 match-state ground truth (KNOWN_MATCHES)

The §27 match-state map the S04 pipeline must produce per fixture — single source of truth:
`scripts/fixture-ground-truth-matches.ts`, asserted byte-stably by
`packages/docx/tests/matching.test.ts` (any change to the scorer, the thresholds, the
fixture bytes, the model shape or the orchestration policy drifts these tables).

### minimal.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### author-date/simple.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c3` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### author-date/et-al.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c3` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### author-date/multiple-authors.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### author-date/same-author-year.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### author-date/missing.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### author-date/ambiguous.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### author-date/vietnamese.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c3` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### documents/docx/apa-like.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c3` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c4` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### documents/docx/harvard.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### documents/docx/plain-text.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### bibliography/no-bibliography.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### bibliography/ambiguous.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]

### bibliography/en-references.docx (match states)

- `c0` → MATCHED → `r0` score 1 tier 1 conf 1 reasons=[exact,year-match]
- `c1` → MATCHED → `r1` score 1 tier 1 conf 1 reasons=[exact,year-match]
- `c2` → MATCHED → `r2` score 1 tier 1 conf 1 reasons=[exact,year-match]
- `c3` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c4` → MATCHED → `r1` score 1 tier 1 conf 1 reasons=[exact,year-match]
- `c5` → MATCHED → `r2` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED | r2:CITED

### bibliography/vi-tai-lieu.docx (match states)

- `c0` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c1` → MATCHED → `r1` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c2` → MATCHED → `r2` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED | r2:CITED

### bibliography/style-position.docx (match states)

- `c0` → POSSIBLE_MISMATCH score 0.6 tier 5 conf 0.6 reasons=[author-mismatch,year-match]
- `c1` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c2` → MATCHED → `r1` score 1 tier 1 conf 1 reasons=[exact,year-match]
- `c3` → MATCHED → `r2` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED | r2:CITED

### match/same-author-two-years.docx (match states)

- `c0` → MATCHED → `r0` score 1 tier 1 conf 1 reasons=[exact,year-match]
- `c1` → MATCHED → `r1` score 1 tier 1 conf 1 reasons=[exact,year-match]
- `c2` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c3` → MATCHED → `r1` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED

### match/ambiguous-same-author-year.docx (match states)

- `c0` → AMBIGUOUS score 1 tier 1 conf 1 reasons=[exact,year-match,ambiguous]
- `c1` → AMBIGUOUS score 0.925 tier 1 conf 0.925 reasons=[exact,year-match,ambiguous]
- `c2` → AMBIGUOUS score 0.925 tier 1 conf 0.925 reasons=[exact,year-match,ambiguous]
- entries → r0:AMBIGUOUS_USAGE | r1:AMBIGUOUS_USAGE

### match/near-miss-author.docx (match states)

- `c0` → POSSIBLE_MISMATCH score 0.525 tier 1 conf 0.525 reasons=[exact,given-initial-mismatch,year-match]
- `c1` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c2` → MATCHED → `r1` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED

### match/near-miss-vietnamese.docx (match states)

- `c0` → MATCHED → `r0` score 0.845 tier 3 conf 0.845 reasons=[diacritic-insensitive,year-match]
- `c1` → POSSIBLE_MISMATCH score 0.6 tier 5 conf 0.6 reasons=[author-mismatch,year-match]
- `c2` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c3` → MATCHED → `r1` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED

### security/vba-sample.docx (match states)

_no citations — empty match map_

### numeric/basic.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c3` → MATCHED → `r1` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c4` → MATCHED → `r2` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED | r2:CITED

### numeric/ranges.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c3` → MATCHED → `r1` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c4` → MATCHED → `r2` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c5` → MATCHED → `r3` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c6` → MATCHED → `r4` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED | r2:CITED | r3:CITED | r4:CITED

### numeric/multiple-brackets.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c3` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c4` → MATCHED → `r1` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c5` → MATCHED → `r2` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c6` → MATCHED → `r3` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED | r2:CITED | r3:CITED

### numeric/out-of-range.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c2` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c3` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c4` → MATCHED → `r1` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c5` → MATCHED → `r2` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED | r2:CITED

### numeric/malformed.docx (match states)

- `c0` → MISSING_REFERENCE score 0 tier 5 conf 0 reasons=[no-entry]
- `c1` → MATCHED → `r0` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c2` → MATCHED → `r1` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- `c3` → MATCHED → `r2` score 0.925 tier 1 conf 0.925 reasons=[exact,year-match]
- entries → r0:CITED | r1:CITED | r2:CITED

## M002-S01 numeric index map ground truth (KNOWN_NUMERIC_INDEX_MAP)

The D016 bracket→bibliography index bindings the numeric mapping pass must produce
per fixture — single source of truth: `scripts/fixture-ground-truth-numeric.ts`,
asserted byte-stably by `packages/docx/tests/numeric-fixture.test.ts` (any change to
the fixture bytes, the model shape, the grammar or the mapping pass drifts these
tables).

### numeric/basic.docx (numeric index map)

- `c0` → 1:resolved->r0
- `c1` → 1:resolved->r0 2:resolved->r1

### numeric/ranges.docx (numeric index map)

- `c0` → 1:resolved->r0 2:resolved->r1 3:resolved->r2 4:resolved->r3
- `c1` → 1:resolved->r0 2:resolved->r1 4:resolved->r3 5:resolved->r4

### numeric/multiple-brackets.docx (numeric index map)

- `c0` → 1:resolved->r0
- `c1` → 2:resolved->r1 3:resolved->r2
- `c2` → 4:resolved->r3

### numeric/out-of-range.docx (numeric index map)

- `c0` → 1:resolved->r0
- `c1` → 5:out-of-range
- `c2` → 0:unmatched

### numeric/malformed.docx (numeric index map)

- `c0` → 3:resolved->r2

### isolation/garbage-and-malformed.docx (numeric index map)

- `c0` → 1:resolved->r0

