"""The plugin registry inference solvers register themselves into.

To add a new inference algorithm, drop a new file into `backend/solvers/`
that calls `@register_solver(...)` on a function matching `SolverFn` --
nothing else in the codebase needs to change. `solvers/__init__.py`
auto-imports every module in that package on startup, which is what runs
the decorator and populates this registry. See `solvers/_template.py` for
an annotated skeleton to copy.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pgmpy.models import DiscreteBayesianNetwork

    from schema import NetworkPayload

# (payload, model, target_variable_ids) -> {variable_id: {state: probability}}
SolverFn = Callable[["NetworkPayload", "DiscreteBayesianNetwork", list[str]], dict[str, dict[str, float]]]


@dataclass(frozen=True)
class SolverInfo:
    name: str
    label: str
    description: str
    supports_sampling: bool
    fn: SolverFn = field(repr=False)


_REGISTRY: dict[str, SolverInfo] = {}


def register_solver(
    name: str,
    *,
    label: str | None = None,
    description: str = "",
    supports_sampling: bool = False,
) -> Callable[[SolverFn], SolverFn]:
    """Decorator that registers an inference solver under ``name``.

    Parameters
    ----------
    name: stable machine identifier sent as ``options.method`` in the API
        (e.g. ``"my_custom_solver"``).
    label: human-readable name shown in the frontend's algorithm picker.
        Defaults to a title-cased version of ``name``.
    description: one-line explanation shown as a tooltip. Defaults to the
        function's docstring.
    supports_sampling: set True if the solver reads ``payload.options.n_samples``
        (e.g. a Monte Carlo method) -- the frontend uses this to decide
        whether to show the sample-count control, so a plugin needs no
        frontend changes to get it.
    """

    def decorator(fn: SolverFn) -> SolverFn:
        if name in _REGISTRY:
            raise ValueError(f"a solver named '{name}' is already registered")
        _REGISTRY[name] = SolverInfo(
            name=name,
            label=label or name.replace("_", " ").title(),
            description=description or (fn.__doc__ or "").strip(),
            supports_sampling=supports_sampling,
            fn=fn,
        )
        return fn

    return decorator


def get_solver(name: str) -> SolverFn | None:
    info = _REGISTRY.get(name)
    return info.fn if info else None


def available_solvers() -> list[SolverInfo]:
    return sorted(_REGISTRY.values(), key=lambda s: s.name)


def is_registered(name: str) -> bool:
    return name in _REGISTRY
