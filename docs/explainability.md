# Explainability

Two read-directly-off-the-graph tools, under **Explain**, that need no data or inference pass -- both are pure
graph-structure queries.

## d-separation / conditional independence

Pick two nodes and an optional observed set; the checker reports whether they're d-separated (and so guaranteed
independent) given that evidence, formally (e.g. `(A ⊥ B | C)`) and in plain language:

- No shared active path at all → marginally independent.
- Conditioning on the given set blocks every path → conditionally independent given that evidence.
- A shared, observed (or observed-descendant) child creates a **v-structure** ("explaining away") that makes them
  *dependent* even if they'd otherwise be independent.
- A direct edge, or an unblocked path through the rest of the network, keeps them dependent.

## Markov blanket

For any node, lists its **parents**, **children**, and **spouses** (co-parents of its children) -- the minimal set
of other variables that fully "shields" it from the rest of the network, i.e. `P(X | MarkovBlanket(X)) = P(X | everything else)`.
