"""Course-aware recommendation engine (4B.2): data -> diagnostics -> selection -> structured output.

Everything except gather.py is pure and can be tested without the database.
"""

from .selection import recommend

__all__ = ["recommend"]
