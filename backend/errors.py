"""Standalone so both `engine.py` and solver plugins can raise it without a
circular import (engine imports the solvers package to trigger registration;
solvers may need to raise validation errors back)."""


class EngineError(ValueError):
    """Raised for malformed networks or unsupported solver configurations."""
