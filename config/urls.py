"""Top-level URL routing.

- ``<BASE_PATH>/api/v1/`` → sync API (``sync``)
- ``<BASE_PATH>/``        → planner frontend / map view (``web``)

``BASE_PATH`` (from ``GC_BASE_PATH``) is empty for the domain root or e.g.
``/gonecycling`` behind a reverse proxy. The proxy passes the full path
incl. prefix through; the routing matches it directly here (no SCRIPT_NAME).
"""
from django.conf import settings
from django.contrib import admin
from django.urls import include, path

# "" → without prefix; "gonecycling" → "gonecycling/".
_p = settings.BASE_PATH.strip("/")
_prefix = f"{_p}/" if _p else ""

urlpatterns = [
    path(f"{_prefix}admin/", admin.site.urls),
    path(f"{_prefix}api/v1/", include("sync.urls")),
    # Optional user accounts (session/CSRF, separate from the token-based sync).
    path(f"{_prefix}accounts/", include("accounts.urls")),
    path(f"{_prefix}", include("web.urls")),
]
