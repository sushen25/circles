# Architecture decision records

Short records of decisions that shape the product or the code. A new ADR is required whenever a rule in the [spec](../mvp-product-spec.md) or the [architecture](../technical-architecture.md) changes. Numbering is sequential; superseded records stay in place with a status line.

The table of every record is [index.md](./index.md). It is generated from each
record's frontmatter (`adr`, `title`, `status`, `amends`, `amended_by`, `superseded_by`) by
`pnpm gen:adrs`, which `pnpm gen` runs. Adding an ADR needs no edit to it by
hand: write the record, run `pnpm gen:adrs`, commit the result. Two branches that
each add an ADR rebase locally without a conflict (`.gitattributes` marks the
index `merge=union`; GitHub's own merge button does not read it, so rebase
before you merge); if the rows land out of order, `pnpm gen:adrs` puts them right.
`pnpm check:docs` fails when the index is stale.

There is no 0042 on `main`: the number is held by the open pull request for
SUS-92 (#95), which carries the record. It is a gap, not a deletion.

## Template

The frontmatter feeds [decisions.base](./decisions.base), the live table of
these records in Obsidian. The status line is what GitHub readers see, so both
are kept and say the same thing. Numbers are plain (`adr: 53`), and the three
relation lists are omitted when empty.

```markdown
---
adr: NN
title: "Title"
status: proposed
date: YYYY-MM-DD
amends: [NN]        # records this one changes
amended_by: [NN]    # records that change this one
builds_on: [NN]     # records this one relies on
---
# ADR NNNN: Title

_Status: proposed | accepted | superseded by NNNN · Date_

## Context
## Decision
## Alternatives considered
## Consequences
```
