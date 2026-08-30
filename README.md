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
- **Stats** — overall progress, a 26-week activity grid you can click into, a
  study streak, per-field progress bars, and the recent session feed.

### Getting around when there are a lot of fields

The bar itself never scrolls. **All**, the **+** button and the field picker
are pinned at one end, the fixed views at the other, and only the field tabs in
between scroll — so no number of fields can push any of them off the screen.
The strip fades at whichever end has more tabs beyond it, a wheel over it moves
it sideways, and opening a field scrolls its tab into view.

The picker is the real answer past a dozen fields. Press **g**, or click the
**N fields ⌄** button, and every field is in one list with its status, topic
count and progress. Type to filter, ↑/↓ to move, Enter to open, Escape to
close — and it drops *below* the bar, so the views pinned beside it stay
visible and clickable while it is open. Starting a new field is at the bottom
of the same panel.

#### Folders

Fields can be filed on **folders**, and a folder can sit inside another, so a
broad subject can be split into its parts: *Mathematics → Pure → Analysis*.
Nesting goes as deep as you like.

A folder is *not* a topic and never appears on a canvas. Making it one would
turn the fields on it into its sub-topics, which is the one thing a field is
not — fields are separate trees. So a folder is a name and nothing else, and
each field remembers which one it is filed on. Filing a field changes where you
*find* it, never where it *sits*: its tree, its status, its progress and its
tab are all exactly as they were.

- **Make one** with *+ New folder* at the bottom of the picker, or **+** on a
  folder's row to make one *inside* it. Either way you name it in the list,
  where it is going to end up, and the picker stays open so you can carry on.
- **File a field** on it from that field's **Details** panel, where everything
  else about where a topic sits is edited.
- **Open a folder in the strip** by clicking its chip: what is inside it drops
  below in a panel — sub-folders you can open in place, and the fields — and
  you pick from there. Arrow keys, → and ← for the sub-folders, and Enter all
  work in it; Escape or a click anywhere closes it, and opening one panel puts
  the others away.
- **In the picker**, a folder expands in place instead, since that list already
  runs downwards. Click it, or use → and ←; Enter on a folder opens it rather
  than jumping anywhere. A folder nobody has touched is open, so filing a field
  never makes it vanish; what you have folded away is remembered between
  visits, and the folder holding the field you are on always opens.
- **Searching opens folders**, because a closed one hiding the only match would
  look like no match at all.
- **Rename or move** with the ✎ on a folder's row, or by double-clicking it:
  one editor with the name and, beside it, the folder it sits inside. It will
  not offer to move a folder into one of its own sub-folders.
- **Remove** with the ×. Removing a folder never removes anything that was in
  it: its fields and its sub-folders come out to wherever it was — the folder
  above it, or the top level.

In the tab strip only **top-level** folders get a chip, and a chip is one slot
however much is inside it — its count is every field beneath it, sub-folders
included. Nothing filed anywhere is a tab of its own. That is what makes
folders worth having on the bar: twenty fields in four folders take four slots,
not twenty, and nesting costs nothing more.

The chip takes the underline when the field you are on is anywhere inside it,
however deep, which is the only way to see where you are once its fields are
off the bar. Fields on no folder stay ordinary tabs.

A folder holding nothing but private work — anywhere beneath it, sub-folders
included — is a label for private work, so its name stays out of the public
snapshot. One with any public field beneath it, or one holding nothing at all,
is published like anything else, and a folder kept when its parent was not
comes out to the top level so the file never names a folder it does not carry.

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

### Connections: one branch shown inside another tree

A reference says two topics relate. A **connection** is structural: it draws a
whole branch inside another tree.

Linear Algebra lives under Mathematics, but Machine Learning rests on it just
as much. Connect Linear Algebra into Machine Learning and the ML tree gains
Linear Algebra with all of its sub-topics, drawn in the connection colour with
a dashed outline and a line reading *from Mathematics*. Nothing is copied and
nothing moves: it is still a child of Mathematics, still in the Mathematics
tab, still one topic with one status and one history. You are looking at the
same thing through two windows.

Make one from the inspector's **Connections** section on the host topic
(*Show a branch here…*), or read it from the other end — the borrowed topic
lists the trees it is shown in. Both ends can remove it. On the canvas, the
head of a borrowed branch carries two buttons: **↗** opens the topic in the
tree it really lives in, and **✂** removes the connection.

Borrowed cards deliberately offer no rename or add-sub-topic: editing another
tree through a window is how trees get confusing. Clicking one selects the
topic and the inspector does everything as usual.

The rules that keep the picture finite and honest:

- A topic cannot be shown inside itself, inside its own sub-topics, or
  anywhere its branch already reaches — that would make the tree contain
  itself. The dropdown only offers topics that pass.
- Nor can it be brought into a tree where it is already drawn: that would put
  two cards for one topic side by side and say nothing new.
- Moving a topic can close a loop that did not exist when the connection was
  made. The move wins and the connection is dropped, because the move was the
  deliberate act.
- A connection is public only when both ends are — like a reference, and for
  the same reason: publishing it would name a private branch and say where it
  is shown.

In the **All** graph a connection pulls like parentage rather than like a
reference, and is drawn as a dashed arrow in the connection colour.

### The focus stopwatch

A timer you set counts down whether or not you are at the desk. Setting 45
minutes and being called away twice does not make it 45 minutes of work, and
logging it as though it were is the tracker lying to you.

So time is recorded with a **stopwatch** instead. It counts up while you work,
you pause it when something takes you away, and what it logs is what actually
happened.

Start one from a card's ⏱ button, from **Focus on this topic** in the
inspector, or with **w** on whatever is selected. You get a screen with the
clock, the topic, and a box for what you are about to do.

- **Pause** when you are interrupted, **resume** when you are back. Space does
  both, so it costs one key.
- Being pulled away is **counted rather than hidden**: the screen says *pulled
  away 3 times · 12m of it*, and the count comes back in the toast when you
  stop. It is not a telling-off, it is the number you would otherwise have to
  guess at.
- **What you are doing** is saved as you type and becomes the note on the
  session, so the day detail reads *45m — CMake · Toolchain files, chapter 3*.
- **Stop & log** banks it as an ordinary session, rounded to the nearest
  minute. Everything that already counts study time — the heatmap, the streak,
  a topic's total, a goal measured in hours — counts it without knowing where
  it came from. **Discard** throws it away instead, and asks first if there was
  anything on the clock.
- Under half a minute rounds to nothing and logs nothing, because a
  nought-minute session would be a lie either way.

**Closing the screen does not stop the clock.** Escape or the × puts it away
and leaves it running; a pill in the header shows the time from anywhere in the
app and takes you back, and the browser tab title counts too, so a stopwatch is
never left running out of sight.

It survives a reload mid-session: elapsed time is derived from timestamps
rather than counted, so nothing is lost by refreshing, and nothing is written
to storage every second either.

Running unattended for more than eight hours, the open stretch is **not**
believed — it pauses itself and says so, keeping what had already been banked.
That holds whether the page was reloaded or the laptop was simply shut and
opened again the next morning: nobody studies for nine hours without touching
the page, and wall-clock time would otherwise invent a session out of a
sleeping tab.

Logging by hand is still there, folded under *Log time by hand* in the
inspector, for work done away from the app.

A running stopwatch is in neither export. It is where the page had got to, not
something learned — and publishing it would put a topic's id and what you were
about to do into a public file.

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

### Activity

The grid on the Stats page counts **activity**, deliberately not
"contributions" — borrowing GitHub's word would eventually get tracker work
confused with git commits. A day's activity is everything recorded on it:
completed tasks, problems solved, notes written, application updates, and
whether any study time was logged.

Hovering a square says what the day held; clicking it opens the day itself:

```
Sunday 23 August — 4 activities

Tasks       ✓ Learn git reset                      Git & Version Control
Problems    Reverse Linked List                    LeetCode · easy
Study       40m — Git & Version Control            reset and reflog
Notes       reflog saved me                        Git & Version Control
```

Anything tied to a topic is clickable and takes you there, so the grid is a way
into your history rather than only a picture of it.

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

### On the problem page

While you are on a LeetCode or Codeforces problem, a small panel in the corner
says what you already know about it:

```
Reverse Linked List
  Solved 18 days ago with a hint
  Booked for a revisit on 2026-09-04
  Last time: off-by-one on the tail
  Prefix sums avoid repeated work
  [ Re-solved ]  [ Revisit in 7 days ]
```

If it is new to you, the panel offers **On my own / With a hint / Read
solution** — recording how it went while that is still fresh, rather than
trying to remember later.

**How it knows.** The extension cannot read the tracker's storage: that lives
on a different origin. So the tracker hands over a compact digest of your
solves whenever you open it — dates, state, how much help, the mistake and the
lesson, and nothing else. The panel says when that digest was last refreshed
rather than pretending to be live. Anything you record there joins the same
queue as a synced solve.

Which problem you are looking at is worked out from the **URL** alone, so
`/contest/1234/problem/A`, `/problemset/problem/1234/A` and `/gym/…` all
resolve to the same problem, and neither site's markup can break it.

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
search is in its history rather than its current state. It reads either as a
**list** grouped by stage, or as a **flow** — bands for each stage joined by
ribbons showing how many applications moved between them, which makes where
things stall obvious at a glance.

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

A node with `"parentId": null` is a top-level field. A field may also name the
folder it is filed on, which is only about where it is found:

```json
{ "id": "math", "parentId": null, "name": "Mathematics", "folderId": "d3" }
```

A folder is a name, and the folder it sits inside if it is not a top-level one:

```json
{ "id": "d3", "name": "Sciences", "parentId": null }
{ "id": "d4", "name": "Physics",  "parentId": "d3" }
```

Sessions reference a node by id:

```json
{ "id": "s12", "nodeId": "hpc-roofline", "date": "2026-08-21",
  "minutes": 70, "note": "Plotted arithmetic intensity." }
```

A connection names the branch and the topic it is shown under, and nothing
else — the branch itself is never duplicated into the host:

```json
{ "id": "c1", "from": "math-linalg", "to": "ml", "label": "the whole basis" }
```

Focus tasks are stored per day, which is what makes the history possible:

```json
{ "id": "f04", "date": "2026-08-22", "text": "Practise std::forward until it sticks",
  "done": true, "doneAt": "2026-08-22T11:05:00.000Z", "nodeId": "cpp-move" }
```

### How much it can hold

The live store is `localStorage`, which browsers cap at roughly **5 MB per
site**. Measured, the state costs about:

| | localStorage |
| --- | --- |
| 50 topics, 200 sessions, 200 solves | 0.2 MB |
| 300 topics, 1 500 sessions, 1 500 solves | 1.6 MB |
| 1 000 topics, 6 000 sessions, 6 000 solves | 6.3 MB — **past the cap** |

Solved problems are what get there first: each carries a title, URL, difficulty
and tags, and a Codeforces sync imports everything back to your first
submission. Topics themselves are cheap.

If a save ever fails, a red bar appears saying so and offering to export
everything — because the alternative is losing the rest of the session on the
next reload without being told. Exporting and starting a fresh browser profile,
or trimming old solves, is the way back under the cap.

The other ceiling is drawing: the **All** graph builds a card for every topic,
so past roughly 500 it is slow to draw and too dense to read. One field at a
time stays fast well beyond that — a single tree of 2 000 topics renders in
under a tenth of a second.

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
`index.html` loads eight plain scripts. `jsdom` is a dev dependency used only to
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
| `tests/pagekey.test.mjs` | Identifying which problem a page is showing, across every URL shape each site uses. |



## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus search |
| `Enter` (in search) | Jump to the first match |
| `n` | Add a sub-topic under the selection (or the field in focus) |
| `N` | Start a new field |
| `g` | Go to a field — opens the picker, then type / ↑↓ / Enter |
| `t` `d` `p` `j` `a` `l` `s` | Tree / Focus / Problems / Projects / Applications / List / Stats |
| `w` | Focus on the selected topic — starts the stopwatch, or goes back to it |
| `Space` | Pause or resume, while the focus screen is up |
| `f` | Fit the tree to the screen |
| `Esc` | Leave the focus screen running, close the picker, or clear the selection |

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
js/focus.js           the stopwatch screen and the running pill
js/app.js             bootstrap, view switching, import/export, shortcuts
data/learning.json    the committed snapshot
extension/            Chrome extension that syncs Codeforces and LeetCode solves
tests/                data model, extension and browser tests
.github/workflows/    test-and-deploy pipeline
```
