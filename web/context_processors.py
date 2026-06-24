"""Provides the deploy/version state to the admin panel (from deploy-state/).

The host watcher writes ``version.json`` (comparison installed ↔ origin) and
``status.json`` (last update). Here they are read in for the templates.
"""
import json

from django.conf import settings


def _read_json(name: str):
    try:
        with open(f"{settings.DEPLOY_SIGNAL_DIR.rstrip('/')}/{name}", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def deploy_info(request):
    """``gc_deploy`` = { version: …|None, status: …|None } for the admin start page."""
    return {
        "gc_deploy": {
            "version": _read_json("version.json"),
            "status": _read_json("status.json"),
        }
    }
