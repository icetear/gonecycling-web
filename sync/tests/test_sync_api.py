"""End-to-end tests of the sync API (pytest-django + DRF APIClient).

Cover auth, pairing, blob roundtrip, optimistic lock, vault isolation,
deletion and validation.
"""
import base64
import secrets

import pytest
from django.test import override_settings
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db

HEALTH = "/api/v1/health"
PAIR = "/api/v1/pair"
MANIFEST = "/api/v1/blobs"
VAULT = "/api/v1/vault"


def blob_url(namespace: str) -> str:
    return f"/api/v1/blobs/{namespace}"


def make_client(token: str | None = None) -> tuple[APIClient, str]:
    """APIClient with a set bearer token (default: fresh 256-bit token)."""
    token = token or secrets.token_hex(32)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return client, token


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


# --- Health & Auth ----------------------------------------------------------

def test_health_is_public():
    res = APIClient().get(HEALTH)
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_missing_token_is_unauthorized():
    assert APIClient().get(MANIFEST).status_code == 401


def test_short_token_is_unauthorized():
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION="Bearer zu-kurz")
    assert client.get(MANIFEST).status_code == 401


# --- Pairing ----------------------------------------------------------------

def test_pair_creates_then_reuses_vault():
    client, _ = make_client()
    first = client.post(PAIR)
    assert first.status_code == 201
    assert first.json()["created"] is True
    assert first.json()["namespaces"] == []

    second = client.post(PAIR)
    assert second.status_code == 200
    assert second.json()["created"] is False


# --- Blob roundtrip ---------------------------------------------------------

def test_put_then_get_roundtrips_ciphertext():
    client, _ = make_client()
    ciphertext = b"\x00\x01encrypted-trips-blob\xff"

    put = client.put(blob_url("trips"), {"ciphertext": b64(ciphertext), "content_version": 3}, format="json")
    assert put.status_code == 200
    assert put.json()["revision"] == 1
    assert put.json()["content_version"] == 3

    get = client.get(blob_url("trips"))
    assert get.status_code == 200
    assert base64.b64decode(get.json()["ciphertext"]) == ciphertext
    assert get.json()["revision"] == 1


def test_put_increments_revision():
    client, _ = make_client()
    client.put(blob_url("rides"), {"ciphertext": b64(b"v1")}, format="json")
    second = client.put(blob_url("rides"), {"ciphertext": b64(b"v2")}, format="json")
    assert second.json()["revision"] == 2


def test_get_unknown_namespace_is_404():
    client, _ = make_client()
    client.post(PAIR)  # vault exists, namespace does not
    assert client.get(blob_url("trips")).status_code == 404


def test_get_without_existing_vault_is_404():
    client, _ = make_client()  # never written/paired → vault does not exist
    assert client.get(blob_url("trips")).status_code == 404


# --- Vault isolation --------------------------------------------------------

def test_vaults_are_isolated_by_token():
    client_a, _ = make_client()
    client_b, _ = make_client()
    client_a.put(blob_url("trips"), {"ciphertext": b64(b"a-secret")}, format="json")
    # B does not know A's token → sees nothing.
    assert client_b.get(blob_url("trips")).status_code == 404


# --- Optimistic concurrency control -----------------------------------------

def test_stale_base_revision_conflicts():
    client, _ = make_client()
    client.put(blob_url("trips"), {"ciphertext": b64(b"v1")}, format="json")  # → rev 1
    client.put(blob_url("trips"), {"ciphertext": b64(b"v2")}, format="json")  # → rev 2

    # Client still thinks it is on rev 1 → conflict.
    conflict = client.put(
        blob_url("trips"),
        {"ciphertext": b64(b"v3"), "base_revision": 1},
        format="json",
    )
    assert conflict.status_code == 409
    assert conflict.json()["current_revision"] == 2

    # With the correct basis it works.
    ok = client.put(
        blob_url("trips"),
        {"ciphertext": b64(b"v3"), "base_revision": 2},
        format="json",
    )
    assert ok.status_code == 200
    assert ok.json()["revision"] == 3


# --- Manifest & deletion ----------------------------------------------------

def test_manifest_lists_namespaces():
    client, _ = make_client()
    client.put(blob_url("trips"), {"ciphertext": b64(b"t")}, format="json")
    client.put(blob_url("rides"), {"ciphertext": b64(b"r")}, format="json")
    names = {n["namespace"] for n in client.get(MANIFEST).json()["namespaces"]}
    assert names == {"trips", "rides"}


def test_delete_namespace():
    client, _ = make_client()
    client.put(blob_url("trips"), {"ciphertext": b64(b"t")}, format="json")
    assert client.delete(blob_url("trips")).status_code == 204
    assert client.get(blob_url("trips")).status_code == 404


def test_delete_vault_removes_everything():
    client, _ = make_client()
    client.put(blob_url("trips"), {"ciphertext": b64(b"t")}, format="json")
    assert client.delete(VAULT).status_code == 204
    assert client.get(MANIFEST).json()["namespaces"] == []


# --- Validation --------------------------------------------------------------

def test_invalid_base64_is_rejected():
    client, _ = make_client()
    res = client.put(blob_url("trips"), {"ciphertext": "nicht-base64!!!"}, format="json")
    assert res.status_code == 400


@override_settings(SYNC_MAX_BLOB_BYTES=16)
def test_oversized_blob_is_rejected():
    client, _ = make_client()
    res = client.put(blob_url("trips"), {"ciphertext": b64(b"x" * 32)}, format="json")
    assert res.status_code == 400
