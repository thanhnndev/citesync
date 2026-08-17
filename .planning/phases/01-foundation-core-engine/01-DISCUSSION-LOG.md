# Phase 01: Foundation & Core Engine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-17
**Phase:** 01-Foundation & Core Engine
**Areas discussed:** Package structure, Parser robustness, Matching accuracy, Fixture & benchmark

---

## Package Structure

### Q1: Package consolidation
| Option | Description | Selected |
|--------|-------------|----------|
| Giữ nguyên 4 packages | Consolidation vào docx + core là đúng. Giữ nguyên cho v0.1, chỉ tách khi cần reuse ở v0.2+ | ✓ |
| Tách lại theo ROADMAP | Tách citations, references, matcher, rules, report thành packages riêng theo ROADMAP gốc | |
| Tách một phần | Tách rules + report ra riêng, giữ citations/references/matcher trong docx | |

**User's choice:** Giữ nguyên 4 packages
**Notes:** Consolidation là kiến trúc cuối cùng cho v0.1. ROADMAP gốc ghi 8 packages nhưng thực tế chỉ cần 4.

### Q2: Rules location
| Option | Description | Selected |
|--------|-------------|----------|
| Giữ trong docx | Rules tightly coupled với matching engine — giữ cùng package | ✓ |
| Tách ra @citesync/rules | Rules riêng để community dễ contribute custom rules | |

**User's choice:** Giữ trong docx

### Q3: Report location
| Option | Description | Selected |
|--------|-------------|----------|
| Giữ trong core | Report là output format của lint — giữ cùng core | ✓ |
| Tách ra @citesync/report | Report riêng để CLI/web có thể import mà không pull cả core | |

**User's choice:** Giữ trong core

---

## Parser Robustness

### Q4: Robustness level
| Option | Description | Selected |
|--------|-------------|----------|
| Core academic patterns | Tập trung vào patterns phổ biến: headings, paragraphs, footnotes, endnotes, tables cơ bản | ✓ |
| Broad coverage | Cố gắng handle tất cả OOXML elements: nested tables, complex numbering, math equations, tracked changes, comments | |

**User's choice:** Core academic patterns
**Notes:** Focus vào patterns phổ biến cho academic documents. Edge cases hiếm sẽ được handle ở version sau.

### Q5: Language support
| Option | Description | Selected |
|--------|-------------|----------|
| UTF-8 full support | Parser xử lý bất kỳ UTF-8 content nào — language-neutral. Citation detection chỉ EN+VI | ✓ |
| EN+VI only | Parser optimize cho English + Vietnamese content | |

**User's choice:** UTF-8 full support

### Q6: Error recovery
| Option | Description | Selected |
|--------|-------------|----------|
| Skip + log issue | Skip phần lỗi, ghi ParseIssue, tiếp tục parse phần còn lại. Failure isolation theo §88 | ✓ |
| Fail fast | Throw error ngay khi gặp unsupported feature | |

**User's choice:** Skip + log issue
**Notes:** Failure isolation là design principle cốt lõi (§88). Parser không nên crash vì một phần malformed.

### Q7: Structured citations priority
| Option | Description | Selected |
|--------|-------------|----------|
| Structured > plain | Ưu tiên CSL_CITATION/Word fields khi có, fallback sang plain-text author-date | ✓ |
| Plain-text first | Parse plain-text trước, structured fields chỉ dùng để cross-validate | |

**User's choice:** Structured > plain

---

## Matching Accuracy

### Q8: Fuzzy algorithm
| Option | Description | Selected |
|--------|-------------|----------|
| Levenshtein distance | Simple edit distance, dễ implement, tốt cho typo correction | ✓ |
| Jaro-Winkler | Tốt hơn cho names (prefix-weighted), nhưng phức tạp hơn | |
| N-gram similarity | Character n-grams, tốt cho partial matches nhưng cần tune n | |

**User's choice:** Levenshtein distance

### Q9: Vietnamese name matching
| Option | Description | Selected |
|--------|-------------|----------|
| Diacritic-insensitive + structure-aware | Strip diacritics + handle middle names/honorifics (Văn, Thị) separately | ✓ |
| Diacritic-insensitive only | Chỉ strip diacritics, treat như ASCII names | |

**User's choice:** Diacritic-insensitive + structure-aware
**Notes:** Vietnamese names cần xử lý cả diacritics lẫn cấu trúc tên (họ đệm, kính ngữ).

### Q10: Threshold strategy
| Option | Description | Selected |
|--------|-------------|----------|
| Fixed thresholds | Hardcode thresholds (match ≥0.75, mismatch <0.50). Đơn giản, deterministic | ✓ |
| Configurable | Cho phép user override thresholds qua .citesyncrc | |

**User's choice:** Fixed thresholds

### Q11: Edge cases
| Option | Description | Selected |
|--------|-------------|----------|
| Handle core cases | Same-author-same-year (a/b), hyphenated names. Skip rare suffixes cho v0.1 | ✓ |
| Full suffix handling | Handle all suffixes: Jr., Sr., II, III, IV, Ph.D., M.D., etc. | |

**User's choice:** Handle core cases

---

## Fixture & Benchmark

### Q12: Fixture strategy
| Option | Description | Selected |
|--------|-------------|----------|
| Mixed: synthetic + few real | Synthetic fixtures cho edge cases (deterministic) + 2-3 real-world DOCX cho integration | ✓ |
| Synthetic only | 100% script-generated fixtures | |
| Real-world only | Real academic papers | |

**User's choice:** Mixed: synthetic + few real

### Q13: Golden file strategy
| Option | Description | Selected |
|--------|-------------|----------|
| Key fixtures only | 5-10 golden files cho representative cases | ✓ |
| All fixtures | Golden files cho mọi fixture | |

**User's choice:** Key fixtures only (5-10 golden files)

### Q14: Benchmark dataset
| Option | Description | Selected |
|--------|-------------|----------|
| 3-5 benchmarks | Small (10p), medium (50p), large (100p), edge-case heavy, Vietnamese | ✓ |
| 10+ benchmarks | Nhiều hơn benchmarks cho comprehensive perf tracking | |

**User's choice:** 3-5 benchmarks

### Q15: Vietnamese fixtures
| Option | Description | Selected |
|--------|-------------|----------|
| Có, fixture riêng | 1-2 Vietnamese fixtures với tên có dấu, bibliography tiếng Việt | ✓ |
| Không, chỉ mixed | Vietnamese content nhúng trong English fixtures | |

**User's choice:** Có, fixture riêng

---

## Agent's Discretion

Không có area nào user để agent quyết định.

## Deferred Ideas

None — discussion stayed within phase scope.
