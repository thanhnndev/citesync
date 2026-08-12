# Fixtures (S01-T7)

Committed .docx binaries authored by `scripts/make-fixtures.ts` (run via `npx tsx`).
Authoring uses fflate + hand-authored OOXML — **never the reader** — and is fully
deterministic (R008/R017): pinned DOS timestamps, fixed entry order, no clock/random.
Re-running the script rewrites byte-identical files.

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

