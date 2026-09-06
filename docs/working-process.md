# Working process

How a ticket actually gets worked, and the rules that came out of getting it
wrong. Kept next to the specs rather than in a wiki so it changes in the same
PR as the thing it describes.

S0-10 creates `AGENTS.md` as the authoritative rules file for coding agents.
When it lands, this document should be linked from it or folded into it — not
duplicated.

---

## 1. The loop

The steps are encoded in `.claude/skills/implement-linear-ticket/`; this is the
shape of them, and the reasoning the script cannot carry.

1. **Fetch the ticket.** `get_issue` with `includeRelations`. `docs/tickets.md`
   maps S-numbers to Linear ids.
2. **Check the blockers.** Every id in `relations.blockedBy` must be Done or
   Canceled. Stop and say which ones are not.
3. **Read first.** `AGENTS.md`, then the ticket's "Read first" list, then
   "Working a ticket" below.
4. **Claim it.** Move to In Progress and assign yourself, before writing code —
   so two people cannot start the same ticket.
5. **Branch** from `main` with Linear's `gitBranchName`, verbatim. Linear's PR
   auto-link depends on it.
6. **Implement** inside the ticket's Scope. Respect Out of scope: a ticket that
   quietly grows is a ticket nobody can review.
7. **Check.** `ticket.sh check` must print `check: ok`. Then walk the
   acceptance criteria one at a time and the definition of done
   (`docs/mvp-product-spec.md` §16).
8. **Push and open the PR.** Title starts with the Linear id.
9. **Hand over.** Move to In Review with the PR link, and comment with the
   decisions taken, what was left out, and anything the next ticket should know.
10. **Report** to the human: PR URL, what was verified and how, what was not,
    and any open question.

### Prerequisites that need a human

Some steps cannot be done by an agent: `gh auth login`, `eas login`, `eas init`
(creates an account-owned project), `sudo` anything, accepting a vendor licence,
installing an SDK.

**Ask for these at the start of the ticket, not when you reach them.** Then do
every step that does not depend on the answer while you wait. S0-02 lost a round
trip by discovering the `eas login` requirement mid-flight.

---

## 2. Rules that came from mistakes

Each of these is here because it actually happened in this repository. The rule
matters more than the story, but the story is what makes the rule stick.

### 2.1 Gate on the exit code, never on the output

**What happened.** Twice, a command of the shape

```bash
ticket.sh check 2>&1 | tail -3
git commit -q -F - <<'EOF'
...
```

committed after a *failing* check, because the pipe replaced the check's exit
status with `tail`'s. Once (PR #2) it also pushed. Both were caught by reading
the printed `check: FAILED` and fixed forward, but a broken commit is in PR #2's
history that never should have existed.

**The rule.** Capture the status and branch on it. Never put a commit or a push
in the same `&&` chain as a piped check.

```bash
ticket.sh check > /tmp/check.log 2>&1
RC=$?
[ $RC -ne 0 ] && { tail -20 /tmp/check.log; exit 1; }
git commit ...
```

### 2.2 Read the diff before committing, not the file

**What happened.** A deliberate boundary violation (`import 'react'` in
`packages/domain`) was added to prove lint catches it, then removed with `sed`.
The removal left a trailing blank line. It was committed, and the clean-clone
verification failed on formatting — after the commit.

**The rule.** Any file touched by a temporary experiment gets a `git diff` before
it is staged. `git checkout -- <file>` is safer than removing an edit by hand.

### 2.3 Exhaust the cheap diagnosis before redesigning

**What happened.** `@circles/tokens/font-assets` failed to resolve on native with
"could not be found within the project". That reads like a bad `exports` map, so
the design was about to be reworked to avoid subpath exports. It was a stale
Metro cache; `expo start --clear` fixed it in one command.

**The rule.** When a build error names a thing you just changed, try the cache
clear, the reinstall and the restart *first*. They cost a minute; a redesign
costs an hour and can bake a workaround into the codebase permanently.

Corollary now recorded in `packages/tokens/README.md`: after changing a
package's `exports`, restart Metro with `--clear`.

### 2.4 A generated file's staleness check must not go through git

**What happened.** `check:tokens` was written as "regenerate, then
`git diff --exit-code`". That cannot tell *stale* from *regenerated but not yet
committed*, so it failed on a working tree that was entirely correct, and cost a
false-failure diagnosis.

**The rule.** Ask the real question: regenerate in memory and compare to the file
on disk. A check that needs a clean tree to be meaningful will lie to you at
exactly the moment you are changing the thing it checks.

### 2.5 Ignore lists are per-tool, not inherited from git

**What happened.** `expo prebuild` writes `apps/app/android` and
`apps/app/ios`. Both are git-ignored — but Prettier and ESLint keep their own
ignore lists, so the first native build put 172 files of Gradle output through
`format:check` and broke `pnpm check`. It was latent from S0-01 for anyone who
had not yet run a native build, and CI would have hit it in S0-09.

**The rule.** When a tool generates a directory, add it to `.gitignore`,
`.prettierignore` **and** the ESLint ignore list in the same change.

### 2.6 Never patch `node_modules`

**What happened.** While diagnosing the iOS build failure, two annotations were
removed from a dependency's headers to find out whether the failure was a
one-liner. Writing to those files in place would have corrupted the shared pnpm
store, because the store hardlinks them — it was avoided by writing a new file
and `mv`-ing over it. Restoring afterwards took `pnpm install --force` *and*
deleting one package directory by hand, because pnpm reused the modified copy.

**The rule.** Do not edit `node_modules`. If a diagnosis genuinely requires it,
write a new file and move it over the old one (never edit in place), and treat
restoring the tree as part of the same task. A real fix is a `pnpm patch`, an
upstream issue, or a version change.

### 2.7 Never stop a process by its port

**What happened.** To stop a local `supabase functions serve`, the port it
answered on was looked up and killed:

```bash
kill $(lsof -ti tcp:54321)   # don't
```

On macOS with Docker Desktop, that port belongs to the Docker backend, not to
the process being targeted. It killed Docker itself, taking every container with
it. Everything came back after `open -a Docker`, but nothing about the command
said it was going to do that.

**The rule.** Stop the thing you started, by its handle: the background task, or
`pkill -f "<the command>"`. A port tells you what is listening, not what you may
kill — and behind a container runtime it is almost never the process you mean.

### 2.8 Extractors fail loudly or they lie

**What happened.** The token generator matched CSS rules with `[^}]*`. Values in
`gen.py` interpolate as `{T['ink2']}`, whose `}` truncated the match — so `.p`
silently fell through to `.invert .p` and picked up the wrong rule. It was caught
only because the wrong rule happened to lack a `font-size` and the extractor
threw.

**The rule.** A generator that reads someone else's file must fail on anything it
does not understand, and name what it could not find. Never let a parse fall
through to a default: the failure mode is silently wrong output that looks
plausible.

### 2.9 Verify a source exists before designing around it

**What happened.** S0-03's plan assumed per-weight static TTFs at
`github.com/google/fonts`. Every one of those paths 404s — the repository ships
variable fonts only. This was caught before anything was downloaded, because the
sizes were checked first in order to ask permission accurately.

**The rule.** When a ticket names an external source, confirm it before building
on it. Checking costs one request. This one worked because the permission step
forced the check — which is an argument for keeping that step.

### 2.10 Stage by name

**The rule.** `git add -A` sweeps up untracked files that belong to the human or
to another change. Add paths explicitly and read `git status --short` before
committing. Untracked files travel across branch switches, so they will follow
you into the wrong commit given the chance.

### 2.11 Say what was not verified

**What happened.** S0-02's acceptance asked for the app running on web, iOS and
Android. Web was verified end to end; iOS ran only through Expo Go; Android was
not exercised at all in that session. The PR said so in a table rather than
implying three ticks.

**The rule.** Report what was actually run, on what, and what was not. A ticket
that is 90% done and honestly labelled is worth more than one claimed complete.

---

## 3. Standing conventions

- **Decisions live in three places, once each**: the code comment says *why this
  line*, the PR body says *why this approach*, the Linear comment says *what the
  next ticket needs to know*. Do not paste the same paragraph into all three.
- **A reversed decision is recorded, not quietly overwritten.** The EAS project
  id moved from an environment variable to a committed constant between S0-02
  and its follow-up; the PR says so and why.
- **Deviations from a ticket are stated in the PR.** S0-04 substituted
  react-native-web + Testing Library for the ticket's React Native Testing
  Library, because RNTL peers on Jest. That is a legitimate call, and it is
  legitimate only because it is written down.
- **`docs/` is generated in one place**: `docs/design/` comes from
  `docs/design/gen.py`. Never hand-edit an artboard. `ticket.sh check`
  regenerates and diffs whenever `docs/design/` changes.
- **Prose is not linted.** `docs/` and `.claude/` are excluded from Prettier so
  the specs keep their own line breaks.
