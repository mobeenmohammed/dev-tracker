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
- **Focus** — a checklist for today: what you intend to work on, ticked off as
  you go. Every past day is kept, so it becomes a record of intentions rather
  than a list that resets. Unfinished work can be carried forward in one click.
- **List** — every topic as a filterable, sortable, foldable list. Selecting a
  row opens an inline editor for notes, a quick time log, and sub-topics,
  without leaving the list.
- **Stats** — overall progress, a 26-week activity heatmap, a study streak,
  per-field progress bars, and the recent session feed.

### The tree

A top-down tidy tree: the field sits at the top, its topics on the row below,
and so on. Every topic is a card carrying its status, checklist count, when it
was last worked on, time logged, and a progress bar. Hovering a card reveals
four actions — rename in place, advance the status one step, add a sub-topic,
or jump to logging time.

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

### Solved problems

Solves are kept apart from time sessions, because a solve is a discrete event
with an identity — `1234A`, rated 1600, tagged `dp` — and that identity is what
makes it countable. A session is time spent; a solve is a thing done.

```json
{ "id": "p-cf1234a", "source": "codeforces", "problemId": "1234A",
  "title": "…", "difficulty": 1600, "tags": ["dp"],
  "perceived": 4, "solvedAt": "2026-08-23", "minutes": 25, "notes": "" }
```

Tags reach the tree through a **mapping table** you control: `dp` points at your
Dynamic Programming topic, `graphs` at your graphs topic, and anything unmapped
sits in a bucket you triage when you feel like it. The mapping is deliberately
manual — automatic tag-to-topic guessing is never quite right.

Set a **problem target** on a topic and solves start counting towards its
progress, which turns "proficient at DP" from a guess into a record.

Solves can be added by hand, or imported in bulk from
**Data ▸ Import solved problems**, which accepts an array of the shape above.
The page also exposes `window.DevTracker.recordSolves([…])`, which is the
surface a browser extension will write through; repeat solves are matched on
`source` + `problemId` and never duplicated.

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



## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `Enter` (in search) | Jump to the first match |
| `n` | Add a sub-topic under the selection (or the field in focus) |
| `N` | Start a new field |
| `t` `d` `p` `a` `l` `s` | Tree / Focus / Problems / Applications / List / Stats |
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
js/applications.js    the Applications view (private data)
js/app.js             bootstrap, view switching, import/export, shortcuts
data/learning.json    the committed snapshot
tests/                data model and browser tests
.github/workflows/    test-and-deploy pipeline
```
