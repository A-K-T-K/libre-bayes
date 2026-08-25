"""Auto-discovery for inference solver plugins.

Every top-level `.py` module in this package (except this file and ones
starting with `_`) is imported here, which is what actually runs each
module's `@register_solver(...)` decorators. This means adding a new
inference algorithm is just "add a new file here" -- nothing imports it by
name, nothing else needs editing.
"""

from __future__ import annotations

import importlib
import pkgutil

for _module_info in pkgutil.iter_modules(__path__):
    if not _module_info.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_module_info.name}")
