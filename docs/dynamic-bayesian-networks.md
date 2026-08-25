# Dynamic Bayesian Networks

A Dynamic Bayesian Network (DBN) models a process that evolves over discrete time steps -- each variable can depend
on its own value one step back, in addition to its ordinary same-slice parents. LibRE Bayes authors these as a
compact **template** (no swimlane of duplicated nodes to manage) and unrolls them to as many time slices as you
need only when running inference.

## Enabling it

1. Toggle **Dynamic BN** in the toolbar. This reveals a **time slices** field (how far to unroll for temporal
   inference and the trajectory plot) and unlocks the per-node temporal option below.
2. Right-click any node → **Enable Temporal**. The node gets a small clock badge on the canvas, and the Inspector
   grows a new **Temporal** section.

## The transition CPT

A temporal node keeps its ordinary `cpt` as its **slice-0 ("initial state")** distribution, conditioned on its
normal parents only -- there's no `t-1` yet at the first slice. A second table, the **transition CPT**, governs
every slice after that: it's conditioned on the node's *own previous-slice value* plus its ordinary *current-slice*
parents. The Inspector's transition grid labels these explicitly -- the `(t-1)` column group is the node's own past
value, every `(t)` group is a parent's current value -- so the two are never ambiguous at a glance.

::: tip Non-temporal nodes in a temporal network
A node you *don't* mark temporal simply gets a fresh, identically-conditioned copy of its ordinary `cpt` at every
slice -- no persistence edge, no evolving distribution. Static and temporal nodes coexist freely on the same
canvas; exogenous inputs or fixed parameters usually shouldn't be temporal at all.
:::

## Virtual (soft) evidence

Hard evidence (`X = x`) always applies at slice 0 (the initial state) -- the same evidence you'd set on a static
network. For evidence at a *specific* later slice, use **virtual evidence** from a temporal node's Inspector:

1. Pick a **time slice** from the dropdown.
2. Fill in a likelihood value per state (they needn't sum to 1 -- this is a likelihood ratio via
   [Jeffrey's rule](https://en.wikipedia.org/wiki/Jeffrey_conditionalization), not a hard assignment).

Setting a new value for an already-set `(node, slice)` pair replaces it rather than stacking -- so you always get
exactly the constraint you last typed, not an accidental compounding of several.

## Reading the results

Each temporal node's Inspector shows a **trajectory** -- a gridded, point-marked line chart of its marginal
probability at every unrolled slice, one line per state, in the same palette as its bar-chart rendering. Click the
expand icon for a full-size view.

## How inference actually runs

Every temporal query dispatches through the *same* solver registry as static inference -- exact or approximate,
built-in or custom -- respecting whatever algorithm is selected in the toolbar. The one exception: if any virtual
evidence is set, inference is forced to exact Variable Elimination (the only algorithm whose API pgmpy exposes
`virtual_evidence` through), with a warning explaining why.

Each `(node, time slice)` marginal is queried individually rather than batched into one request across the whole
unrolled network -- batching a large simultaneous query can force certain solvers to materialize a joint tensor
across every requested variable at once, which scales explosively with slice count even when the underlying model's
actual treewidth is small. Querying one variable at a time keeps every call's cost bounded by the model's real
complexity instead.

::: warning Large unrolls
Past a certain number of unrolled `(node, slice)` variables, a warning is returned recommending fewer time slices
or an approximate solver -- densely-connected networks can still be slow to solve exactly at scale, independent of
this per-variable-query optimization.
:::
