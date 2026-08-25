# Learning from Data

## Structure learning

**Auto-Discover DAG** fits a graph structure from an uploaded CSV, via three algorithms:

| Algorithm | Approach | Scoring |
| --- | --- | --- |
| Hill-Climb Search | Greedy local search over the DAG space | BIC, K2, or BDeu |
| PC | Constraint-based (conditional independence tests) | -- |
| Tree Search (Chow-Liu) | Maximum-weight spanning tree | -- |

Hill-Climb and PC both accept **required** and **forbidden** edge constraints if you already know part of the
structure; Tree Search doesn't support constraints (a warning is returned if you supply them anyway). Columns the
algorithm leaves disconnected still become root nodes in the result, so nothing from the CSV silently disappears.

## Parameter learning

**Fit from CSV** estimates every mapped node's CPT from data, given a structure that's already on the canvas:

- **Maximum Likelihood Estimation (MLE)** -- pure frequency counts.
- **Bayesian estimation** -- MLE regularized with a Dirichlet prior (**BDeu**, **K2**, or a flat **Dirichlet**
  prior), controlled by an equivalent sample size. Prefer this when some parent-state combinations are rare in
  your data; MLE silently falls back to a uniform distribution for a combination with zero training rows, which
  looks confident but isn't -- the response's `sparse_columns` flags exactly which ones that happened to, so the UI
  can warn about them.

Only nodes you explicitly map to a CSV column get (re-)fit; a mapped node's parents must be mapped too, since
there's otherwise no data to condition on.

## Synthetic data

**Synthetic Data** forward-samples the current network to a CSV -- optionally under a `do()`-intervention or fixed
evidence, with a seed for reproducibility. Useful for generating a test dataset with a known ground-truth structure,
or for round-tripping through structure/parameter learning to sanity-check them against a model you already trust.
