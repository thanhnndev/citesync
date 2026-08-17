# Constraints — Synthesized from PRD + UI-SPEC

## Technical Constraints (from PRD §86)

- No server dependency
- No database dependency
- No mandatory WASM runtime
- No large ML models
- No API keys
- No vendor-specific AI services
- Dependencies must remain reasonably small

## Scope Constraints (from PRD §8, §68)

### Excluded from v0.1
- PDF support
- Google Docs extension
- Microsoft Word plugin
- Reference existence verification
- DOI lookup / Crossref / OpenAlex integration
- LLM parsing / AI writing
- Plagiarism detection
- Grammar checking
- Citation style formatting / bibliography generation
- Automatic document editing
- User accounts / cloud storage / collaboration / document history

## Input Constraints (from PRD §12–13)

- v0.1 input: .docx only
- Recommended max document size: 50 MB
- Unsupported: .doc, .pdf, .odt, .pages, .tex, Google Docs links, scanned documents, images

## UI Constraints (from UI-SPEC)

- Report byte-identical — UI never changes report data (D024)
- data-testid FROZEN — 5 e2e specs depend on 23 patterns
- No LLM in UI (R012)
- No guessing when data insufficient (§79)
- UI scope: apps/web only — no engine/worker/report changes
- Stage labels EN literal — engine→UI contract (D025)
- Font services not allowed — system fonts + @fontsource local only (offline-first)

## Performance Constraints (from PRD §55)

- 100-page DOCX < 3 seconds on typical modern laptop
- Heavy parsing in Web Worker
- UI stays responsive during analysis

## Browser Constraints (from PRD §56)

- Priority: Chrome, Edge, Firefox, Safari
- Desktop first
- Mobile only when technically practical

## Coding Constraints (from PRD §94–95)

- Source files < 400 lines per file (tests exempt)
- Small pure functions, clear boundaries, fixture-driven development
- Predictability, testability, deterministic output prioritized

## Language Constraints (from PRD §54)

- v0.1 UI: English only
- Parser: English + Vietnamese author names and bibliography headings
- Vietnamese bibliography heading support required

## Security Constraints (from PRD §87)

- DOCX is untrusted input
- Never execute macros or embedded content
- Never load remote document URLs
- Never evaluate scripts
- Limit decompressed archive size (zip bomb protection)
- Validate XML sizes
- Limit processing time
