# Wenna documentation

This folder is the repository's documentation and an Obsidian vault at the
same time. The files are plain Markdown and live in git; Obsidian adds the
graph, backlinks, search and the live ADR table on top. Nothing here depends
on Obsidian being open, and nothing in the repository reads `.obsidian/`.

| | |
|---|---|
| Product | [mvp-product-spec.md](mvp-product-spec.md) · the first draft in [initial-mvp-product-spec.md](initial-mvp-product-spec.md), reviewed in [mvp-spec-review.md](mvp-spec-review.md) |
| Architecture | [technical-architecture.md](technical-architecture.md) |
| Design | [design-manifesto.md](design-manifesto.md) · artboards and `gen.py` in `design/` (hidden from search and the graph) |
| Decisions | [decisions/README.md](decisions/README.md) · live table in [decisions/decisions.base](decisions/decisions.base) |
| Guest → app | [guest-to-app-flow.md](guest-to-app-flow.md) |
| How we work | [working-process.md](working-process.md) · tickets in [tickets.md](tickets.md) |
| Runbooks | [runbooks/README.md](runbooks/README.md) |
| Research | [branding](research/branding-research.md) · [consumer SaaS](research/consumer-saas-success-research.md) · [the meetup market](research/meetup-market-research.md) · [software moats](research/software-moats-research.md) |
| Audits | `audits/` · review reports, kept out of git because the repository is public |

The rules for anyone working in the repository are in `AGENTS.md`, one level
up and outside the vault, where agents and tooling find it by path.

## Writing here

- Links are relative Markdown links with the `.md` extension, as they always
  were. They resolve on GitHub, in editors, for agents and in Obsidian alike.
  Obsidian is set to write links this way; leave that setting alone.
- No Obsidian-only syntax in the body of a note: no `[[wikilinks]]`, embeds,
  callouts, `==highlights==` or `%%comments%%`. GitHub shows them as noise.
- No links to headings. Obsidian and GitHub disagree on how a heading becomes
  an anchor, so a heading link works in one and breaks in the other.
- Do not rename or move a file. Code, CI and the skills refer to these paths,
  and Obsidian only updates the links it can see.
- New files are kebab-case, like the ones around them.
- A link out of `docs/` into the code (the runbooks do this) works on GitHub
  and shows as unresolved in Obsidian, which cannot see past the vault. That
  is expected; do not "fix" it by copying the file in.
- ADRs carry frontmatter (`adr`, `title`, `status`, `date`, and `amends`,
  `amended_by`, `builds_on` as lists of ADR numbers). The status line under
  the heading stays, because GitHub readers see that and not the table.
  A new ADR starts from the template in `_templates/adr.md`.
- A new runbook gets a row in `runbooks/README.md`; any other new document
  gets a row in the table above. The skills in `.claude/skills/` point here
  and expect both.
- `pnpm check:docs`, inside `pnpm check` and in CI's prose lane, fails on a
  link to nothing, a heading link, a wikilink or callout, or an ADR whose
  frontmatter, status line and README row disagree. It skips `audits/` (not in
  git), `_templates/` and `design/`.
