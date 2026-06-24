"""Rate limiting per vault.

Since the identity is the token hash (no classic user with ``pk``), we use
our own throttle class that throttles based on the token hash. Complements the
IP-based ``AnonRateThrottle`` and limits e.g. token guessing/spam.
"""
from rest_framework.throttling import SimpleRateThrottle


class VaultRateThrottle(SimpleRateThrottle):
    """Throttles requests per vault (via the token hash)."""

    scope = "vault"

    def get_cache_key(self, request, view):
        user = getattr(request, "user", None)
        token_hash = getattr(user, "token_hash", None)
        if not token_hash:
            # Not authenticated → this (vault-related) throttle does not apply.
            return None
        return self.cache_format % {"scope": self.scope, "ident": token_hash}
