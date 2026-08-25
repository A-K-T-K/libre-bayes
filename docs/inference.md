# Inference

## Algorithms

The algorithm picker in the toolbar is populated live from `GET /api/solvers` -- every registered solver shows up
automatically, including your own custom ones (see [Extending the Engine](/extending)).

| Algorithm | Type | Notes |
| --- | --- | --- |
| Variable Elimination | Exact | General-purpose default |
| Belief Propagation | Exact | Junction-tree message passing |
| Likelihood Weighting | Approximate | Vectorized weighted sampling; fast on large/dense networks -- exposes a sample-count control |
| `opt_einsum` tensor contraction | Exact | Sub-millisecond on small/medium networks |

**Auto Infer** re-runs inference (debounced) on every structural or evidence change; toggle it off and use
**Infer Now** for manual control on large networks where you'd rather batch several edits first.

## Evidence and interventions

- **Evidence** (Observation mode): `P(Y | X = x)`, a Bayesian conditioning update.
- **Interventions** (Intervention mode): `P(Y | do(X = x))`, Pearl's causal surgery -- every incoming edge to the
  intervened node is cut and its CPT replaced with a point mass at the chosen state *before* the solver runs, so
  every registered solver (including custom ones) transparently supports interventions with no changes of its own.

The two can genuinely disagree: observing "the sprinkler is on" raises your belief that it's *not* raining (an
explaining-away effect through their shared child), while *forcing* the sprinkler on with `do()` has no such
backward effect on rain at all.

## MAP queries

**Find Most Likely Scenario** computes the single highest-probability full joint assignment over every non-evidence
node, consistent with current evidence -- always exact (Variable Elimination), regardless of which solver is
currently selected, since MAP is a distinct operation pgmpy only implements exactly. The result's joint probability
is computed directly from the model's own CPDs via the chain rule once every variable is pinned down.
