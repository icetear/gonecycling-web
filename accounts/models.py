"""Data model of the optional user accounts ("upgrade").

Unlike the anonymous, zero-knowledge sync (``sync/``), this is a **classic
account**: email + password, activation by mail, login/logout via Django's
session auth. Deliberately separate from the sync core — ``sync`` stays token-based
and anonymous. Here the server stores PII (name/email) and the ``master_secret``,
so the user can sign in on a **new device** and restore their encrypted
trips (this is the deliberate departure from the zero-knowledge
promise — only for upgrade users; the anonymous sync stays unaffected).
"""
from django.contrib.auth.models import User
from django.db import models

from sync.models import Vault


class Profile(models.Model):
    """App-specific profile data for exactly one Django ``User``.

    Login/password/activation come from Django's ``User`` (``username`` =
    email, ``first_name`` = first name, ``last_name`` = last name, ``is_active`` =
    confirmed by mail). Only the sync binding and metadata live here.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")

    #: Anonymous vault carried over during the "upgrade" (optional, purely informational/for
    #: later cleanup — functionally the vault is resolved during pairing anyway).
    vault = models.ForeignKey(
        Vault, null=True, blank=True, on_delete=models.SET_NULL, related_name="profiles"
    )

    #: base64url-encoded ``master_secret`` of the user. DELIBERATELY stored
    #: server-side (classic account, no zero-knowledge): enables login on
    #: new devices including decryption of one's own trips. Example length ~43
    #: characters (256 bit base64url); 256 as a generous upper bound.
    master_secret = models.CharField(max_length=256, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:  # pragma: no cover - debug display only
        return f"Profile({self.user.email})"
