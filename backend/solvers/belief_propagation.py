from pgmpy.inference import BeliefPropagation

from solver_registry import register_solver

from ._shared import factor_to_marginals


@register_solver(
    "belief_propagation",
    label="Exact: Belief Propagation",
    description="Exact inference via calibrated junction-tree message passing.",
)
def solve(payload, model, targets):
    infer = BeliefPropagation(model)
    infer.calibrate()
    result = infer.query(variables=targets, evidence=payload.evidence or None, show_progress=False)
    return factor_to_marginals(result, targets)
