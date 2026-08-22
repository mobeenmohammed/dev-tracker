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
- **Focus** — a checklist for today: what you intend to work on, ticked off as
  you go. Every past day is kept, so it becomes a record of intentions rather
  than a list that resets. Unfinished work can be carried forward in one click.
- **List** — every topic as a filterable, sortable, foldable list. Selecting a
  row opens an inline editor for notes, a quick time log, and sub-topics,
  without leaving the list.
- **Stats** — overall progress, a 26-week activity heatmap, a study streak,
  per-field progress bars, and the recent session feed.

### Two tree layouts

The button on the canvas switches between them:

- **Cards** (the default) — a horizontal tidy tree where every topic is a card
  you can work from directly. Each card carries its status, when it was last
  worked on, time logged, and a progress bar for its branch. Hovering reveals
  four actions: rename in place, advance the status one step, add a sub-topic,
  or jump to logging time. Rectangular cards need room, which is why this
  layout runs left-to-right instead of around a circle.
- **Radial map** — the compact dendrogram, better for taking in every field at
  once. Colour is status, ring distance is depth.

Drag to pan, scroll to zoom, click to inspect, double-click a node to collapse
its branch.

### Knowing when you last worked on something

Every topic tracks its own history, surfaced in four places:

- a **halo** around any node worked on in the last 7 days;
- a **relative date** under each label (`3d ago`, `2w ago`) — toggle with the
  stopwatch button on the canvas;
- a **Last worked** line in the inspector, with the exact date;
- a **when** column in the list, highlighted while it is still recent.

A parent reports the most recent activity anywhere in its branch, so a quiet
field is obvious at a glance.

Progress rolls up the same way: a leaf topic scores its own status, and a
parent averages its children, so a field's percentage reflects everything
beneath it.

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

```
edit in the browser  ->  Data ▸ Export JSON  ->  overwrite data/learning.json  ->  commit & push
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

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. **Settings ▸ Pages ▸ Build and deployment**, source **Deploy from a branch**.
3. Branch `main`, folder `/ (root)`. Save.
4. It appears at `https://<username>.github.io/<repo>/` within a minute or two.

No workflow file is needed — the site is served as-is. The `.nojekyll` file
stops Pages from running the content through Jekyll.

## Tests

```bash
node tests/store.test.mjs
```

Covers the data model: progress roll-up, time aggregation, last-worked
lookups and relative-date wording, streaks, cascade deletes, the cycle guard on
moves, timezone-safe date arithmetic, the daily focus checklist and its
carry-over rules, and the export/import round-trip. No dependencies.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `Enter` (in search) | Jump to the first match |
| `n` | Add a sub-topic under the selection (or the field in focus) |
| `N` | Start a new field |
| `t` `d` `l` `s` | Tree / Focus / List / Stats |
| `f` | Fit the tree to the screen |
| `Esc` | Clear the selection |

## Layout

```
index.html            markup and the SVG scaffold
css/styles.css        design tokens, dark and light themes
js/store.js           data model, persistence, derived metrics
js/tree.js            radial layout, SVG rendering, pan and zoom
js/views.js           inspector, list view, stats view
js/app.js             bootstrap, view switching, import/export, shortcuts
data/learning.json    the committed snapshot
tests/store.test.mjs  data model tests
```
