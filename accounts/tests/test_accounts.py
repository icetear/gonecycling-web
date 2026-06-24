"""Tests of the "upgrade"/account lifecycle (register → activate → login).

Pure API/logic tests via the Django test client. The ``mailoutbox`` fixture
(pytest-django) automatically provides the in-memory mail backend, so that the
sent activation mail is checkable.
"""
import json

import pytest
from django.contrib.auth.models import User
from django.urls import reverse

from accounts import views as account_views
from accounts.models import Profile
from sync.auth import hash_token
from sync.models import Vault

pytestmark = pytest.mark.django_db

# A valid (long) master_secret + corresponding "derived" token. For the
# tests any string suffices; the crypto derivation itself is checked in the JS
# tests.
SECRET = "dummy-master-secret-not-real"
AUTH_TOKEN = "a" * 64


def _post(client, name, payload):
    return client.post(reverse(name), data=json.dumps(payload), content_type="application/json")


def _register(client, email="max@example.com", password="supersecret", auth_token=AUTH_TOKEN):
    return _post(
        client,
        "accounts:register",
        {
            "email": email,
            "first_name": "Max",
            "last_name": "Mustermann",
            "password": password,
            "master_secret": SECRET,
            "auth_token": auth_token,
        },
    )


# --- Registration -----------------------------------------------------------

def test_register_creates_inactive_user_and_sends_mail(client, mailoutbox):
    res = _register(client)
    assert res.status_code == 201

    user = User.objects.get(username="max@example.com")
    assert user.is_active is False  # only active after mail confirmation
    assert user.first_name == "Max" and user.last_name == "Mustermann"
    assert user.check_password("supersecret")

    profile = Profile.objects.get(user=user)
    assert profile.master_secret == SECRET
    # Vault binding via the token hash (same identity as in the sync).
    assert profile.vault is not None
    assert profile.vault.token_hash == hash_token(AUTH_TOKEN)

    assert len(mailoutbox) == 1
    assert "max@example.com" in mailoutbox[0].to
    assert "/accounts/activate/" in mailoutbox[0].body


def test_register_duplicate_email_conflicts(client, mailoutbox):
    assert _register(client).status_code == 201
    res = _register(client)
    assert res.status_code == 409


def test_register_without_vault_binding_when_no_auth_token(client, mailoutbox):
    res = _register(client, auth_token="")
    assert res.status_code == 201
    profile = Profile.objects.get(user__username="max@example.com")
    assert profile.vault is None
    assert Vault.objects.count() == 0


@pytest.mark.parametrize(
    "payload, status",
    [
        ({"email": "kein-email", "first_name": "A", "last_name": "B", "password": "supersecret", "master_secret": SECRET}, 400),
        ({"email": "a@b.de", "first_name": "", "last_name": "B", "password": "supersecret", "master_secret": SECRET}, 400),
        ({"email": "a@b.de", "first_name": "A", "last_name": "B", "password": "kurz", "master_secret": SECRET}, 400),
        ({"email": "a@b.de", "first_name": "A", "last_name": "B", "password": "supersecret", "master_secret": ""}, 400),
    ],
)
def test_register_validation_errors(client, mailoutbox, payload, status):
    res = _post(client, "accounts:register", payload)
    assert res.status_code == status
    assert User.objects.count() == 0
    assert len(mailoutbox) == 0


# --- Activation -------------------------------------------------------------

def test_activate_valid_token_activates(client, mailoutbox):
    _register(client)
    user = User.objects.get(username="max@example.com")
    token = account_views._activation_token(user)

    res = client.get(reverse("accounts:activate", args=[token]))
    assert res.status_code == 200
    user.refresh_from_db()
    assert user.is_active is True


def test_activate_invalid_token(client):
    res = client.get(reverse("accounts:activate", args=["not-a-valid-token"]))
    assert res.status_code == 400


def test_activate_expired_token(client, mailoutbox, monkeypatch):
    _register(client)
    user = User.objects.get(username="max@example.com")
    token = account_views._activation_token(user)
    # Validity window artificially "expired" → SignatureExpired branch.
    monkeypatch.setattr(account_views, "ACTIVATION_MAX_AGE", -1)
    res = client.get(reverse("accounts:activate", args=[token]))
    assert res.status_code == 400
    user.refresh_from_db()
    assert user.is_active is False


# --- Login / Logout / Me ----------------------------------------------------

def test_login_blocked_until_activated(client, mailoutbox):
    _register(client)
    res = _post(client, "accounts:login", {"email": "max@example.com", "password": "supersecret"})
    assert res.status_code == 403
    assert res.json().get("reason") == "inactive"


def test_login_success_returns_master_secret(client, mailoutbox):
    _register(client)
    user = User.objects.get(username="max@example.com")
    user.is_active = True
    user.save(update_fields=["is_active"])

    res = _post(client, "accounts:login", {"email": "max@example.com", "password": "supersecret"})
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == "max@example.com"
    assert body["master_secret"] == SECRET


def test_login_wrong_password(client, mailoutbox):
    _register(client)
    User.objects.filter(username="max@example.com").update(is_active=True)
    res = _post(client, "accounts:login", {"email": "max@example.com", "password": "falsch1234"})
    assert res.status_code == 401


def test_me_reflects_session(client, mailoutbox):
    # Anonymous → not authenticated.
    assert client.get(reverse("accounts:me")).json() == {"authenticated": False}

    _register(client)
    User.objects.filter(username="max@example.com").update(is_active=True)
    _post(client, "accounts:login", {"email": "max@example.com", "password": "supersecret"})

    me = client.get(reverse("accounts:me")).json()
    assert me["authenticated"] is True
    assert me["email"] == "max@example.com"
    assert me["master_secret"] == SECRET

    # After logout anonymous again.
    client.post(reverse("accounts:logout"))
    assert client.get(reverse("accounts:me")).json() == {"authenticated": False}


def test_resend_is_silent(client, mailoutbox):
    # Unknown email → still 200, but no mail.
    res = _post(client, "accounts:resend", {"email": "niemand@example.com"})
    assert res.status_code == 200
    assert len(mailoutbox) == 0

    # Unconfirmed profile → renewed mail.
    _register(client)
    mailoutbox.clear()
    res = _post(client, "accounts:resend", {"email": "max@example.com"})
    assert res.status_code == 200
    assert len(mailoutbox) == 1


# --- Password reset ---------------------------------------------------------

def _activate(email="max@example.com"):
    User.objects.filter(username=email).update(is_active=True)


def test_password_reset_request_sends_mail_for_active(client, mailoutbox):
    _register(client)
    _activate()
    mailoutbox.clear()
    res = _post(client, "accounts:password_reset", {"email": "max@example.com"})
    assert res.status_code == 200
    assert len(mailoutbox) == 1
    assert "/accounts/password/reset/confirm/" in mailoutbox[0].body


def test_password_reset_request_silent_for_unknown_or_inactive(client, mailoutbox):
    # Unknown email → 200, no mail.
    assert _post(client, "accounts:password_reset", {"email": "ghost@example.com"}).status_code == 200
    # Registered but inactive → 200, no mail (reset only for active accounts).
    _register(client)
    mailoutbox.clear()
    assert _post(client, "accounts:password_reset", {"email": "max@example.com"}).status_code == 200
    assert len(mailoutbox) == 0


def test_password_reset_confirm_get_form_and_invalid(client, mailoutbox):
    _register(client)
    _activate()
    token = account_views._password_reset_token(User.objects.get(username="max@example.com"))
    ok = client.get(reverse("accounts:password_reset_confirm", args=[token]))
    assert ok.status_code == 200
    assert b'name="password"' in ok.content  # form page
    bad = client.get(reverse("accounts:password_reset_confirm", args=["kein-token"]))
    assert bad.status_code == 400


def test_password_reset_confirm_sets_new_password(client, mailoutbox):
    _register(client)
    _activate()
    user = User.objects.get(username="max@example.com")
    secret_before = user.profile.master_secret
    token = account_views._password_reset_token(user)

    res = client.post(
        reverse("accounts:password_reset_confirm", args=[token]),
        {"password": "neuespasswort", "password2": "neuespasswort"},
    )
    assert res.status_code == 200
    user.refresh_from_db()
    assert user.check_password("neuespasswort")
    # master_secret stays unaffected (password = login credential, not the enc key).
    assert user.profile.master_secret == secret_before

    # Login with the new password works, with the old one no longer.
    assert _post(client, "accounts:login", {"email": "max@example.com", "password": "neuespasswort"}).status_code == 200
    client.post(reverse("accounts:logout"))
    assert _post(client, "accounts:login", {"email": "max@example.com", "password": "supersecret"}).status_code == 401


def test_password_reset_confirm_mismatch_keeps_password(client, mailoutbox):
    _register(client)
    _activate()
    user = User.objects.get(username="max@example.com")
    token = account_views._password_reset_token(user)
    res = client.post(
        reverse("accounts:password_reset_confirm", args=[token]),
        {"password": "neuespasswort", "password2": "anders123"},
    )
    assert res.status_code == 200
    user.refresh_from_db()
    assert user.check_password("supersecret")  # unchanged


# --- Password change (logged in) --------------------------------------------

def _login(client, email="max@example.com", password="supersecret"):
    return _post(client, "accounts:login", {"email": email, "password": password})


def test_password_change_requires_login(client):
    res = _post(client, "accounts:password_change", {"old_password": "x", "new_password": "neuespasswort"})
    assert res.status_code == 403


def test_password_change_wrong_old(client, mailoutbox):
    _register(client)
    _activate()
    _login(client)
    res = _post(client, "accounts:password_change", {"old_password": "falsch1234", "new_password": "neuespasswort"})
    assert res.status_code == 400
    assert User.objects.get(username="max@example.com").check_password("supersecret")


def test_password_change_success_keeps_session(client, mailoutbox):
    _register(client)
    _activate()
    _login(client)
    res = _post(client, "accounts:password_change", {"old_password": "supersecret", "new_password": "neuespasswort"})
    assert res.status_code == 200
    user = User.objects.get(username="max@example.com")
    assert user.check_password("neuespasswort")
    # Session persists after the change (update_session_auth_hash).
    assert client.get(reverse("accounts:me")).json()["authenticated"] is True


def test_password_change_too_short(client, mailoutbox):
    _register(client)
    _activate()
    _login(client)
    res = _post(client, "accounts:password_change", {"old_password": "supersecret", "new_password": "kurz"})
    assert res.status_code == 400
    assert User.objects.get(username="max@example.com").check_password("supersecret")


# --- Delete profile ---------------------------------------------------------

def test_delete_profile_requires_login(client):
    assert _post(client, "accounts:delete", {}).status_code == 403


def test_delete_profile_removes_account_logs_out_keeps_vault(client, mailoutbox):
    _register(client)  # creates user + profile + (via auth_token) a vault
    _activate()
    _login(client)
    assert Vault.objects.count() == 1

    res = _post(client, "accounts:delete", {})
    assert res.status_code == 200

    # User + profile are removed …
    assert User.objects.filter(username="max@example.com").count() == 0
    assert Profile.objects.count() == 0
    # … but the vault (ciphertext) stays (only the binding is released).
    assert Vault.objects.count() == 1
    # Session ended → anonymous again.
    assert client.get(reverse("accounts:me")).json() == {"authenticated": False}


# --- Management command: send_test_email ------------------------------------

def test_send_test_email_command(mailoutbox):
    from django.core.management import call_command

    call_command("send_test_email", "ops@example.com")
    assert len(mailoutbox) == 1
    assert "ops@example.com" in mailoutbox[0].to
    assert mailoutbox[0].subject == "GoneCycling: Test email"
