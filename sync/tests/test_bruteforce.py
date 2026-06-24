"""Tests of the brute-force protection: IP block after N wrong hashes + admin mail."""
import secrets

import pytest
from django.core import mail
from django.test import RequestFactory, override_settings
from rest_framework.test import APIClient

from sync.security import client_ip

pytestmark = pytest.mark.django_db

PULL = "/api/v1/blobs/trips"
PAIR = "/api/v1/pair"

EMAIL_LOCMEM = "django.core.mail.backends.locmem.EmailBackend"


def pull_unknown(client: APIClient, ip: str):
    """Pull with a FRESH (unknown) token from `ip` → "wrong hash"."""
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {secrets.token_hex(32)}")
    return client.get(PULL, HTTP_X_FORWARDED_FOR=ip)


@override_settings(EMAIL_BACKEND=EMAIL_LOCMEM, BRUTEFORCE_MAX_FAILURES=3, ADMIN_ALERT_EMAIL="admin@example.com")
def test_three_wrong_hashes_block_ip_and_email_admin():
    c = APIClient()
    ip = "203.0.113.7"

    r1 = pull_unknown(c, ip)
    assert r1.status_code == 404 and r1.json()["reason"] == "hash_invalid"
    r2 = pull_unknown(c, ip)
    assert r2.status_code == 404 and r2.json()["reason"] == "hash_invalid"
    r3 = pull_unknown(c, ip)
    assert r3.status_code == 403 and r3.json()["reason"] == "ip_blocked"

    # From now on the IP is blocked — even a pairing is rejected.
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {secrets.token_hex(32)}")
    r4 = c.post(PAIR, HTTP_X_FORWARDED_FOR=ip)
    assert r4.status_code == 403 and r4.json()["detail"] == "IP blocked."

    # Exactly one admin mail to admin@example.com with the IP in the subject.
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == ["admin@example.com"]
    assert ip in mail.outbox[0].subject


@override_settings(EMAIL_BACKEND=EMAIL_LOCMEM, BRUTEFORCE_MAX_FAILURES=3)
def test_successful_access_resets_counter():
    c = APIClient()
    ip = "198.51.100.5"
    token = secrets.token_hex(32)

    # Create vault (legitimate pairing resets the counter anyway).
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    c.post(PAIR, HTTP_X_FORWARDED_FOR=ip)

    pull_unknown(c, ip)  # failures = 1
    pull_unknown(c, ip)  # failures = 2

    # Successful access to the existing vault (namespace missing) → reset.
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    ok = c.get(PULL, HTTP_X_FORWARDED_FOR=ip)
    assert ok.status_code == 404 and "reason" not in ok.json()  # vault present → no failed attempt

    # After the reset, two more failed attempts do NOT block yet.
    assert pull_unknown(c, ip).status_code == 404
    assert pull_unknown(c, ip).status_code == 404


@override_settings(BRUTEFORCE_MAX_FAILURES=3)
def test_blocks_are_per_ip():
    c = APIClient()
    for _ in range(3):
        pull_unknown(c, "203.0.113.1")  # IP1 → blocked
    # IP2 is unaffected by this.
    assert pull_unknown(c, "203.0.113.2").status_code == 404


def test_client_ip_uses_last_forwarded_entry():
    rf = RequestFactory()
    req = rf.get("/", HTTP_X_FORWARDED_FOR="1.1.1.1, 203.0.113.9")
    assert client_ip(req) == "203.0.113.9"  # IP as seen by the proxy, spoofing-resistant
    assert client_ip(rf.get("/")) == "127.0.0.1"  # no XFF → REMOTE_ADDR
