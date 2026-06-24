"""Authentication via the anonymous vault token.

The client sends ``Authorization: Bearer <token>``. We only check the format
and pass on the **hash** of the token — deliberately NO database access
happens here (no creation of vaults on mere reads). Resolving/creating the
concrete ``Vault`` happens in the views (only on write accesses or during
pairing).
"""
import hashlib

from rest_framework import authentication, exceptions

#: Minimum length of the token. The client generates 256 bit (e.g. 64 hex characters);
#: we reject anything significantly shorter to prevent weak tokens.
MIN_TOKEN_LENGTH = 32


def hash_token(token: str) -> str:
    """SHA-256 hex of the token — this is the server-side identity of the vault."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class VaultIdentity:
    """Lightweight "user" replacement: carries only the token hash, no PII.

    On successful authentication DRF expects a truthy
    ``request.user`` with ``is_authenticated``. We attach the token hash to it,
    from which the views resolve the ``Vault``.
    """

    is_authenticated = True
    is_anonymous = False

    def __init__(self, token_hash: str):
        self.token_hash = token_hash

    def __str__(self) -> str:  # pragma: no cover
        return f"VaultIdentity({self.token_hash[:8]}…)"


class VaultTokenAuthentication(authentication.BaseAuthentication):
    """Bearer token authentication without database access."""

    keyword = "Bearer"

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode("latin-1")
        if not header:
            # No header → no authentication (leads to 401 with IsAuthenticated).
            return None

        parts = header.split()
        if parts[0] != self.keyword:
            # Different auth scheme → this class is not responsible.
            return None
        if len(parts) == 1:
            raise exceptions.AuthenticationFailed("No token in the Authorization header.")
        if len(parts) > 2:
            raise exceptions.AuthenticationFailed("Malformed Authorization header (space in the token?).")

        token = parts[1]
        if len(token) < MIN_TOKEN_LENGTH:
            raise exceptions.AuthenticationFailed("Token too short.")

        return (VaultIdentity(hash_token(token)), None)

    def authenticate_header(self, request) -> str:
        # Ensures that missing/invalid tokens count as 401 (not 403).
        return self.keyword
