"""Tests of the admin update page (auth + writing signal, without privileges)."""
import json

import pytest

pytestmark = pytest.mark.django_db

# URLs without GC_BASE_PATH (tests run at the root).
DEPLOY = "/deploy/"


def test_deploy_requires_login(client):
    res = client.get(DEPLOY)
    assert res.status_code == 302
    assert "/admin/login/" in res.url  # staff_member_required → admin login


def test_non_staff_is_rejected(client, django_user_model):
    user = django_user_model.objects.create_user("bob", password="pw")
    client.force_login(user)
    res = client.get(DEPLOY)
    assert res.status_code == 302  # not staff → back to login


def test_staff_can_view_and_trigger(client, django_user_model, settings, tmp_path):
    settings.DEPLOY_SIGNAL_DIR = str(tmp_path)
    admin = django_user_model.objects.create_user("admin", password="pw", is_staff=True, is_superuser=True)
    client.force_login(admin)

    # show page
    res = client.get(DEPLOY)
    assert res.status_code == 200
    assert b"update" in res.content.lower()

    # trigger update → writes ONLY the signal request with action=deploy
    res = client.post(DEPLOY)
    assert res.status_code == 302
    request_file = tmp_path / "request"
    assert request_file.exists()
    payload = json.loads(request_file.read_text())
    assert payload["action"] == "deploy" and payload["by"] == "admin" and "at" in payload


def test_status_is_displayed(client, django_user_model, settings, tmp_path):
    settings.DEPLOY_SIGNAL_DIR = str(tmp_path)
    (tmp_path / "status.json").write_text(json.dumps({"state": "ok", "message": "Fertig", "commit": "abc1234"}))
    admin = django_user_model.objects.create_user("a2", password="pw", is_staff=True, is_superuser=True)
    client.force_login(admin)
    res = client.get(DEPLOY)
    assert res.status_code == 200
    assert b"abc1234" in res.content  # host status is displayed


def test_check_version_writes_signal(client, django_user_model, settings, tmp_path):
    settings.DEPLOY_SIGNAL_DIR = str(tmp_path)
    admin = django_user_model.objects.create_user("a3", password="pw", is_staff=True, is_superuser=True)
    client.force_login(admin)
    res = client.post("/check-version/", {"next": "/admin/"})
    assert res.status_code == 302
    payload = json.loads((tmp_path / "request").read_text())  # shared signal
    assert payload["action"] == "check"


def test_ajax_post_returns_json(client, django_user_model, settings, tmp_path):
    settings.DEPLOY_SIGNAL_DIR = str(tmp_path)
    admin = django_user_model.objects.create_user("a5", password="pw", is_staff=True, is_superuser=True)
    client.force_login(admin)
    res = client.post("/check-version/", HTTP_X_REQUESTED_WITH="XMLHttpRequest")
    assert res.status_code == 200 and res.json()["ok"] is True
    assert json.loads((tmp_path / "request").read_text())["action"] == "check"


def test_deploy_status_endpoint(client, django_user_model, settings, tmp_path):
    settings.DEPLOY_SIGNAL_DIR = str(tmp_path)
    (tmp_path / "version.json").write_text(json.dumps({"installed": "aaa", "behind": "2"}))
    admin = django_user_model.objects.create_user("a6", password="pw", is_staff=True, is_superuser=True)
    client.force_login(admin)
    res = client.get("/deploy-status/")
    assert res.status_code == 200
    body = res.json()
    assert body["version"]["behind"] == "2" and body["status"] is None


def test_check_version_requires_staff(client):
    res = client.post("/check-version/")
    assert res.status_code == 302
    assert "/admin/login/" in res.url


def test_admin_index_shows_update_panel(client, django_user_model, settings, tmp_path):
    settings.DEPLOY_SIGNAL_DIR = str(tmp_path)
    (tmp_path / "version.json").write_text(json.dumps({
        "checked_at": "2026-06-21T11:00:00+02:00", "branch": "master",
        "installed": "aaaa111", "origin": "bbbb222", "behind": "3", "ahead": "0",
    }))
    admin = django_user_model.objects.create_user("a4", password="pw", is_staff=True, is_superuser=True)
    client.force_login(admin)
    res = client.get("/admin/")
    assert res.status_code == 200
    body = res.content.decode()
    assert "Server update" in body
    assert "Check version" in body
    assert "3 Commit(s) behind" in body  # behind count from version.json
