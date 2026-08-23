# Learning Tree

A personal tracker for what I am learning, drawn as a radial tree that grows
as topics are added and statuses advance. Built as a static site with no
dependencies and no build step, so GitHub Pages can serve it directly.

## What it does

A tab bar runs across the top: **All**, then one tab per field, then **+**,
with **Focus**, **List** and **Stats** always pinned on the right.

- **All** — every field in one tree, which is where the connections between
  subjects are visible.
- **A field tab** (C++, HPC, …) — re-roots the tree on that field alone, so it
  becomes its own tree to grow. Add topics inside it without the other fields
  in the way.
- **+** — names a new field inline in the tab strip and drops you into its
  empty tree, for when you start something completely new.
- **Problems** — every problem you have solved, counted by tag so the practice
  is visible: how many DP problems, how many graph problems, how hard they
  felt. Filter by platform, keep notes per problem, and map tags onto topics so
  solves become evidence in the tree.
- **Applications** — a private pipeline for job and internship applications,
  with a stage timeline per application and what needs chasing next.
- **Projects** — the things you have built, and which concepts each one is
  evidence for. Studying CI/CD and having CI run on every push are different
  claims; this is where the second one lives.
- **Focus** — goals with a target date, and a checklist for today: what you intend to work on, ticked off as
  you go. Every past day is kept, so it becomes a record of intentions rather
  than a list that resets. Unfinished work can be carried forward in one click.
- **List** — every topic as a filterable, sortable, foldable list. Selecting a
  row opens an inline editor for notes, a quick time log, and sub-topics,
  without leaving the list.
- **Stats** — overall progress, a 26-week activity heatmap, a study streak,
  per-field progress bars, and the recent session feed.

### The tree, and the graph

A **field tab** shows that field as a top-down tidy tree: the field at the top,
its topics on the row below, and so on. Hierarchy is the right shape for one
subject.

**All** is not a hierarchy — topics reference each other across fields — so it
is a force-directed graph of every card, in the spirit of a knowledge graph.
Parent-child edges pull, every pair pushes, references pull more weakly, and
the result settles into clusters. Drag any card to place it and it stays put;
the button on the canvas lays the whole thing out again.

Positions are cached, so selecting a card or ticking something off never
reshuffles the picture.

### References and prerequisites

The tree says where a topic *sits*; a reference says what it *relates to*.
Probability relates to Randomised Algorithms without either owning the other,
and only a graph can express that.

Add one from the inspector's **References** section, optionally labelled. They
are drawn as dashed, arrowed curves in their own colour so a relationship is
never mistaken for containment, and both ends list the reference. The toggle on
the canvas hides them.

A reference is public only when both of its ends are: link a public topic to a
private one and the reference itself goes to the private file.

Each reference says **how** the two relate — `relates to`, `requires`,
`is part of`, `extends`, `is used by` — which is what makes it checkable rather
than decorative. Mark Concurrency as requiring Processes, start Concurrency,
and leave Processes untouched, and the inspector says so:

> You are working on this, but Processes is still not started.

### The cards

Every topic is a card carrying its status, checklist count, when it was last
worked on, time logged, and a progress bar. Hovering reveals four actions —
rename in place, advance the status one step, add a sub-topic, or jump to
logging time.

Drag to pan, scroll to zoom, click a card to inspect it, double-click its title
to rename, and use the badge in the corner to fold a branch away.

### The inspector

Selecting a card opens a panel that reads top to bottom in the order you
actually think about a topic:

1. **Title** and where it sits.
2. **What this is** — a description you write, saved as you type.
3. **Status** — planned through mastered.
4. **Resources & tasks** — a checklist. Anything with a link becomes one;
   everything else is a plain task to tick off.
5. **Progress** — the percentage, and a line saying where it came from.
6. **Time** — total logged, when you last worked on it, and the session log.
7. **Details** — name, parent, tags, privacy, timestamps.

Drag the divider on its left edge to make the panel wider (arrow keys work too
when it has focus); the width is remembered.

### Knowing when you last worked on something

A topic's recency shows up as a date on its card, a line in the inspector, and
a highlighted column in the list. A parent reports the most recent activity
anywhere in its branch, so a quiet field is obvious at a glance. The stopwatch
button on the canvas toggles the dates on the cards.

### How progress is calculated

A topic's progress is the **strongest claim available**, so adding new evidence
can only ever help:

| Claim | Value |
| --- | --- |
| Status | its weight, 0% for planned up to 100% for mastered |
| Checklist | `ticked / total`, when there are items |
| Problems | `solved / target`, when a target is set on the topic |

A **parent** averages its children, so a field's percentage reflects everything
beneath it.

Ticking the last item on a checklist marks the topic **Mastered** — finishing
the list is a claim that the topic is done. Un-ticking never demotes it: the
status is yours to lower.

### Statuses

| Status | Weight | Meaning |
| --- | --- | --- |
| Planned | 0% | On the list, not started |
| Learning | 25% | Actively reading or watching |
| Practicing | 55% | Writing code or working problems |
| Proficient | 80% | Comfortable without a reference |
| Mastered | 100% | Could teach it |

## How data is stored

There is no backend. The app keeps its working copy in `localStorage`, and
`data/learning.json` is the versioned snapshot committed to the repo.

### Goals

A field is never finished — you do not complete Mathematics. A goal is the
opposite: a few concrete things, by a date.

```
Comfortable with modern C++          30 days remaining      71%
██████████████░░░░░░
  ✓ Build one C++ project
  ✓ C++ reaches Proficient           status
 50% gdb checklist                   3 of 6
 25% 4 problems in C++               1/4
```

A part is either something you tick off yourself, or something the tracker can
answer: a topic reaching a status, a checklist finishing, N problems solved, or
N hours logged. Those answer themselves as you work, so goal progress is never
a second thing to keep up to date.

If a goal points at a topic you later delete, the part becomes an ordinary
checkbox rather than disappearing — the intention was real.

### Projects

Concepts say what you have studied; problems say what you have practised. A
project says what you have **built**, and which concepts it demonstrates:

```
Order Book            ████████████████░░  82%   Building   3 concepts
   C++          the matching engine
   Testing      74 tests
   CI/CD        GitHub Actions on every push
```

Each project keeps a state, repository, technologies, milestones that drive its
progress, and a set of linked concepts with a sentence saying how each was
used. Open a linked topic and its inspector shows **Used in** — so the tree can
now distinguish a topic you read about from one you shipped something with.

A project can be marked private, in which case it goes to `data/private.json`
like a private branch.

### Journal and Obsidian

Each topic takes short dated notes — somewhere to put *"finally understood why
this works"* at the moment it happens, attached to the topic and the day.

This is not a notes app and does not try to be. If you keep real notes in
Obsidian, give a topic a vault path (`My Vault/CS/Linked Lists`) and the
inspector shows an **Open** button that launches the note through the
`obsidian://` URL scheme. The vault stays the source of truth; the tracker only
points at it.

### Solved problems

Solves are kept apart from time sessions, because a solve is a discrete event
with an identity — `1234A`, rated 1600, tagged `dp` — and that identity is what
makes it countable. A session is time spent; a solve is a thing done.

```json
{ "id": "p-cf1234a", "source": "codeforces", "problemId": "1234A",
  "title": "…", "difficulty": 1600, "tags": ["dp"],
  "perceived": 4, "solvedAt": "2026-08-23", "minutes": 25, "notes": "" }
```

Problems come from anywhere — a site, a university problem set, a textbook, an
interview-prep list. The built-in sources cover the common platforms and you
can add your own.

Tags start from a built-in vocabulary spanning algorithms, data structures,
graphs, mathematics and systems, offered as suggestions as you type. It is a
starting point, not a whitelist: anything you type is a valid tag.

Tags reach the tree through a **mapping table** you control: `dp` points at your
Dynamic Programming topic, `graphs` at your graphs topic, and anything unmapped
sits in a bucket you triage when you feel like it. The mapping is deliberately
manual — automatic tag-to-topic guessing is never quite right.

Set a **problem target** on a topic and solves start counting towards its
progress, which turns "proficient at DP" from a guess into a record.

### What happened when you solved it

Counting solved problems rewards volume. What actually moves the needle is
going back to the ones that beat you, so each solve records a short debrief:

| Field | Why it is there |
| --- | --- |
| How much help | "Solved" and "solved after reading the answer" are not the same claim |
| Attempts | Three goes at something is a different experience from one |
| How hard it felt | Independent of whatever the site rates it |
| Where it went wrong | Off-by-one, wrong data structure — the pattern repeats |
| What you took from it | The sentence worth remembering |
| Revisit in | 3 days, a week, a month |

Problems then move through **Solved → Needs review → Re-solved → Mastered**,
and anything flagged or due surfaces in **Worth revisiting** at the top of the
page, saying why it is there.

### Evidence, and a status the record supports

Because solves carry all of that, a topic's inspector can show what is actually
known about it rather than only what you claimed:

```
12 solved   ·   90% without help   ·   5/4/3 easy/med/hard   ·   3 days ago
```

From that it offers a status — *"The record suggests Proficient: 12 problems
solved, 90% without help"* — with a button to accept it. It only ever suggests
moving **forwards**, and never changes anything on its own: you may know
something the problem log does not.

Solves can be added by hand, or imported in bulk from
**Data ▸ Import solved problems**, which accepts an array of the shape above.
The page also exposes `window.DevTracker.recordSolves([…])`, which is the
surface a browser extension will write through; repeat solves are matched on
`source` + `problemId` and never duplicated.

### Syncing solves automatically

`extension/` holds a Chrome extension (Manifest V3) that records accepted
submissions, with their tags and difficulty, into the tracker.

Both supported sites are read through **public APIs that need no account and no
key**, so nothing is scraped and a redesign cannot break the sync:

| Site | Endpoint | History available |
| --- | --- | --- |
| Codeforces | `user.status` | Everything, back to your first submission |
| LeetCode | GraphQL `recentAcSubmissionList` | Only a rolling window of your 20 most recent |
| Project Euler | none — a button on the page | Whatever you log, from when you install it |

Project Euler cannot be polled at all: it has no API and solved status exists
only behind your login. Rather than guess at page structure that cannot be
verified, the extension puts a **Log problem N** button on every problem page.
It reads the number from the URL, which is stable, so a redesign costs you a
click rather than your data. If the page happens to say your answer was
correct, the button says so too — but it never acts on its own.

**What the LeetCode window means.** Each call returns the twenty most recent
accepted submissions *as of that moment* — asking for fifty still returns
twenty. It is a window that slides forward, not a cap on the total: poll it
regularly and everything new is captured, since solves are matched on
`source` + `problemId` and never duplicated. Two consequences follow. Nothing
solved **before** you set it up can be read, so the first check simply records
where you are and starts from there. And if you ever solved more than twenty
problems between two checks, the ones in the middle would fall out of the
window — for reference, twenty solves spans weeks at a typical pace, so an
hourly check has enormous headroom.

If you do want the twenty currently visible, the options page has a button for
it. Otherwise LeetCode starts clean.

**Removing synced solves.** *Remove all from…* in the Problems tab clears
everything one source contributed; it appears once you filter to that source.
The extension's *Reset sync position* is a different thing entirely: it clears
only the extension's memory of how far it has read, deletes nothing from the
tracker, and makes the next Codeforces check re-read your whole history — which
will re-add solves you had deleted.

LeetCode's submission list carries no tags or difficulty, so each new problem
is looked up once through the same public API and cached.

**Ratings and levels are not the same claim.** Codeforces rates a problem 1600;
LeetCode bands it Medium. They are stored in separate fields and never
converted into each other.

**Installing it**

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked**, and pick the `extension/` folder.
3. Open its **Options**, enter your Codeforces handle and/or LeetCode
   username, and press **Sync now**.

A desktop notification appears when a solve is found, which can be switched off
in the same place.

One site failing never stops the other: each is tried on its own and whatever
went wrong is reported on the options page.

**How a solve reaches the tracker**

```
service worker polls both sites
   -> accepted submissions become solves, queued in extension storage
   -> you open the tracker
   -> content script offers the queue by postMessage
   -> the page stores them and acknowledges exactly what it kept
   -> only those are dropped from the queue
```

The tracker has no backend, so nothing can be pushed to it; the handover
happens whenever you next open the page. Because the page acknowledges what it
stored, a tab closed mid-handover loses nothing, and the same solve arriving
twice is matched on `source` + `problemId` rather than duplicated.

Only the first accepted submission per problem counts, so re-solving something
does not inflate the numbers, and dates use your local calendar day rather than
UTC — an evening solve is not filed under tomorrow.

The extension ships allowing `mobeenmohammed.github.io/dev-tracker/` and
`localhost`; change `host_permissions` and `content_scripts.matches` in
`extension/manifest.json` if the tracker lives elsewhere.

### Applications

A stage pipeline with a dated timeline per application, because the shape of a
search is in its history rather than its current state.

Changing the stage records a dated event, but **correcting a mis-click leaves
no trace**: a change made the same day, on top of an automatic event nobody has
annotated, rewrites that event rather than stacking another, and lands back to
nothing if it returns where it started. So clicking *Interview* by accident and
putting it back does not leave "reached interview" true forever. Anything you
write a note on is never rewritten.

Pasting a posting URL fills in what the URL already knows — Greenhouse, Lever,
Ashby, Workday, SmartRecruiters, Workable, LinkedIn and company career sites
are recognised — using nothing but pattern matching. No request is made.

Company logos are **off by default and shown as initials**, because fetching a
real logo would tell that company's server which companies you are tracking.
The toggle says so plainly, and when enabled the icon is fetched from the
company's own domain rather than a third-party logo service.

### Public and private data

The repository is public, so Pages can serve it. Anything that should not be
published is marked **private** on its branch in the inspector, and privacy is
inherited by everything beneath it.

Exporting then produces two files:

| File | Contents | Committed? |
| --- | --- | --- |
| `learning.json` | Everything public: the tree, sessions, tasks, solves, tag mappings. | Yes — this is what the site serves. |
| `private.json` | Private branches with their sessions, tasks and solves — **and every job application**. | No — `data/private.json` is git-ignored. |

**Applications are private by construction, not by a flag you have to
remember.** They are never written to the public snapshot under any
circumstances, so a public repository can never carry where you applied or who
turned you down. CI fails the build if an `applications` key ever appears in
committed data.

The app loads `data/private.json` on startup if it happens to be there, so on
your own machine the tree is whole, while the published site only ever sees the
public half. CI fails the build if private data is ever committed.

```
edit in the browser  ->  Data ▸ Export public snapshot  ->  overwrite data/learning.json  ->  commit & push
```

On load, the app compares the committed file with what is in the browser. If
the file is newer, a banner offers to load it — which is how a second device
picks up changes.

`data/learning.json` is a flat node list rather than nested objects, so adding
a topic shows up as a one-line diff.

```json
{ "id": "hpc-cuda", "parentId": "hpc-parallel", "name": "CUDA",
  "status": "planned", "tags": ["gpu"], "notes": "", "resources": [] }
```

A node with `"parentId": null` is a top-level field. Sessions reference a node by id:

```json
{ "id": "s12", "nodeId": "hpc-roofline", "date": "2026-08-21",
  "minutes": 70, "note": "Plotted arithmetic intensity." }
```

Focus tasks are stored per day, which is what makes the history possible:

```json
{ "id": "f04", "date": "2026-08-22", "text": "Practise std::forward until it sticks",
  "done": true, "doneAt": "2026-08-22T11:05:00.000Z", "nodeId": "cpp-move" }
```

## Running it locally

Any static server works. From the repo root:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk mostly works too, but some browsers
block the `fetch` of `data/learning.json` over `file://`, in which case the app
falls back to whatever is in `localStorage`.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`, which:

1. installs dependencies and runs the whole test suite,
2. checks `data/learning.json` still parses and holds nodes,
3. fails the build if any private data was committed by mistake,
4. and only then publishes to GitHub Pages.

A failing test stops the deploy, so the live site never moves ahead of a broken
commit. Pages is configured with **GitHub Actions** as its source, not
"deploy from a branch". The `.nojekyll` file stops Pages running the content
through Jekyll.

## Tests

```bash
npm install     # once, for jsdom
npm test
```

The site itself has no runtime dependencies — nothing is bundled or built, and
`index.html` loads four plain scripts. `jsdom` is a dev dependency used only to
drive the page in tests.

| Suite | What it covers |
| --- | --- |
| `tests/store.test.mjs` | The data model, with no dependencies at all. |
| `tests/browser/app.test.mjs` | The whole UI driven through real events: tabs, cards, the inspector, checklists, privacy, the list, and the focus checklist. |
| `tests/browser/boot.test.mjs` | Starting up from saved state, including a field deleted since the last visit. |
| `tests/browser/styles.test.mjs` | That nothing marked `hidden` is still displayed — a real bug once left an invisible overlay covering the canvas. |
| `tests/extension.test.mjs` | Mapping Codeforces submissions to solves: verdict filtering, one entry per problem, incremental syncing, and the fields the API omits. |
| `tests/leetcode.test.mjs` | Mapping LeetCode submissions to solves: the rolling window, string timestamps, enrichment from the question lookup, and errors returned inside a 200 response. |
| `tests/euler.test.mjs` | Reading a Project Euler problem page: the number from the URL, and the fallbacks the title degrades through when markup changes. |



## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `Enter` (in search) | Jump to the first match |
| `n` | Add a sub-topic under the selection (or the field in focus) |
| `N` | Start a new field |
| `t` `d` `p` `j` `a` `l` `s` | Tree / Focus / Problems / Projects / Applications / List / Stats |
| `f` | Fit the tree to the screen |
| `Esc` | Clear the selection |

## Layout

```
index.html            markup and the SVG scaffold
css/styles.css        design tokens, dark and light themes
js/store.js           data model, persistence, derived metrics
js/tree.js            card layout, SVG rendering, pan and zoom
js/views.js           inspector, focus, list and stats views
js/problems.js        the Problems view and solve import
js/projects.js        the Projects view and concept evidence
js/applications.js    the Applications view (private data)
js/app.js             bootstrap, view switching, import/export, shortcuts
data/learning.json    the committed snapshot
extension/            Chrome extension that syncs Codeforces and LeetCode solves
tests/                data model, extension and browser tests
.github/workflows/    test-and-deploy pipeline
```
