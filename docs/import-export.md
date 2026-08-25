# Import / Export

| Format | Extension | Notes |
| --- | --- | --- |
| Native JSON | `.json` | Full fidelity, including Dynamic BN fields (`temporal`, `transition_cpt`, `dbn_time_slices`, `virtual_evidence`) |
| Bayesian Interchange Format | `.bif` | Via pgmpy's reader/writer |
| Hugin NET | `.net` | Via pgmpy's reader/writer |
| GeNIe / SMILE | `.xdsl` | Via pgmpy's reader/writer, pretty-printed |
| DSC | `.dsc` | Hand-rolled (pgmpy has no DSC support) -- a Hugin-NET-like plain-text format |

Use **File → Save As** / **Open** for any of these. Only the native JSON format currently round-trips Dynamic BN
fields -- the other four are static-network interchange formats with no concept of time slices, so exporting a
temporal network to BIF/NET/XDSL/DSC keeps each node's *slice-0* behavior only.

::: tip Malformed files
Every import path validates that at least one node actually resulted from parsing -- a handful of external formats'
readers can silently return an empty-but-valid model for garbage input rather than raising, which would otherwise
surface as a confusing blank canvas instead of a clear error.
:::
