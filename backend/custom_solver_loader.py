"""Runtime registration of user-authored custom solver plugins, submitted
through the app's "+ Custom Inference Method…" dialog. See
solvers/SCHEMA.md for the full contract this follows -- in short, it turns
submitted code into a real file in `solvers/` using the exact same pattern
as a hand-written plugin, then imports it immediately.
"""

from __future__ import annotations

import ast
import importlib
import re
from pathlib import Path

from errors import EngineError
from solver_registry import is_registered

SOLVERS_DIR = Path(__file__).parent / "solvers"
_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


def register_custom_solver(name: str, label: str, description: str, code: str) -> None:
    name = name.strip()
    if not _NAME_RE.match(name):
        raise EngineError(
            "name must be a valid identifier: letters, digits, underscore, and can't start with a digit"
        )
    if is_registered(name):
        raise EngineError(f"a solver named '{name}' is already registered")

    file_path = SOLVERS_DIR / f"custom_{name}.py"
    if file_path.exists():
        raise EngineError(f"a custom solver file for '{name}' already exists on disk")

    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise EngineError(f"code does not parse: {exc}") from exc

    has_solve = any(
        isinstance(node, ast.FunctionDef) and node.name == "solve" for node in ast.walk(tree)
    )
    if not has_solve:
        raise EngineError(
            "code must define a top-level function named `solve(payload, model, targets)` -- see solvers/SCHEMA.md"
        )

    module_source = (
        f'"""Custom solver plugin: {label}\n\n'
        f"Auto-generated via the \"Custom Inference Method\" dialog. See "
        f'solvers/SCHEMA.md for the plugin contract this follows."""\n\n'
        f"from solver_registry import register_solver\n\n"
        f"{code}\n\n"
        f"register_solver({name!r}, label={label!r}, description={description!r})(solve)\n"
    )

    file_path.write_text(module_source, encoding="utf-8")

    try:
        importlib.import_module(f"solvers.custom_{name}")
    except Exception as exc:  # noqa: BLE001 - surfaced to the dialog as the failure reason
        file_path.unlink(missing_ok=True)
        raise EngineError(f"custom solver failed to register: {exc}") from exc
