from pgmpy.inference import ApproxInference

from solver_registry import register_solver

from ._shared import factor_to_marginals


@register_solver(
    "likelihood_weighting",
    label="Approx: Likelihood Weighting",
    description="Vectorized weighted sampling; fast on large/dense networks.",
    supports_sampling=True,
)
def solve(payload, model, targets):
    n_samples = payload.options.n_samples or 10_000
    infer = ApproxInference(model)
    result = infer.query(
        variables=targets,
        evidence=payload.evidence or None,
        n_samples=n_samples,
        show_progress=False,
    )
    return factor_to_marginals(result, targets)
