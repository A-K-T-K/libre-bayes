from pgmpy.inference import VariableElimination

from solver_registry import register_solver

from ._shared import factor_to_marginals


@register_solver(
    "variable_elimination",
    label="Exact: Variable Elimination",
    description="Exact inference by eliminating non-query variables one at a time.",
)
def solve(payload, model, targets):
    infer = VariableElimination(model)
    result = infer.query(variables=targets, evidence=payload.evidence or None, show_progress=False)
    return factor_to_marginals(result, targets)
