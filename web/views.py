import json
from pathlib import Path

from django.conf import settings
from django.contrib import messages
from django.contrib.admin.views.decorators import staff_member_required
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.utils.http import url_has_allowed_host_and_scheme
from django.views import View
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.generic import TemplateView


@method_decorator(ensure_csrf_cookie, name="dispatch")
class HomeView(TemplateView):
    """Single-page shell of the planner (map + trip/tour planning).

    Passes the optional URL subpath (``BASE_PATH``) to the template, so that
    the frontend builds the correct API base (``window.GC_BASE_PATH`` →
    ``app.js``). Static URLs already get the prefix via ``STATIC_URL``.

    ``ensure_csrf_cookie`` sets the ``csrftoken`` cookie already on page
    load, so that ``static/js/accounts.js`` can secure the POSTs (register/login/…)
    with the ``X-CSRFToken`` header (session-based account endpoints).
    """

    template_name = "index.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["base_path"] = settings.BASE_PATH  # "" or e.g. "/gonecycling"
        return context


def _signal_dir() -> Path:
    return Path(settings.DEPLOY_SIGNAL_DIR)


def _write_signal(request, action: str) -> bool:
    """Writes the watcher signal ``request`` with ``action`` ("check"/"deploy").

    The view itself does **nothing** privileged — it only drops this
    file into a directory mounted to the host. A systemd watcher
    outside the container evaluates the ``action`` field (see ``deploy/host/``).
    """
    directory = _signal_dir()
    try:
        directory.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"action": action, "at": timezone.now().isoformat(), "by": request.user.get_username()})
        tmp = directory / "request.tmp"
        tmp.write_text(payload)
        tmp.replace(directory / "request")
        return True
    except OSError as error:
        messages.error(request, f"Action failed: {error}")
        return False


def _is_ajax(request) -> bool:
    return request.headers.get("x-requested-with") == "XMLHttpRequest"


def _safe_next(request, fallback: str = "deploy") -> str:
    """Validated redirect target from ``next`` (against open redirect), otherwise fallback."""
    nxt = request.POST.get("next")
    if nxt and url_has_allowed_host_and_scheme(nxt, allowed_hosts={request.get_host()}, require_https=request.is_secure()):
        return nxt
    return fallback


def _read_json(name: str) -> dict | None:
    try:
        return json.loads((_signal_dir() / name).read_text())
    except (OSError, ValueError):
        return None


@method_decorator(staff_member_required, name="dispatch")
class DeployView(View):
    """Operator page (staff/superuser): triggers a server update by
    only writing the ``request`` signal (details see ``_write_signal``)."""

    template_name = "deploy.html"

    def get(self, request):
        return render(request, self.template_name, {
            "base_path": settings.BASE_PATH,
            "status": _read_json("status.json"),
            "version": _read_json("version.json"),
        })

    def post(self, request):
        ok = _write_signal(request, "deploy")
        if _is_ajax(request):
            return JsonResponse({"ok": ok})
        if ok:
            messages.success(request, "Update requested — the server will update shortly.")
        return redirect(_safe_next(request))


@method_decorator(staff_member_required, name="dispatch")
class CheckVersionView(View):
    """Triggers a version comparison (signal ``request`` with action=check).
    The host watcher does ``git fetch`` and writes ``version.json`` back."""

    def post(self, request):
        ok = _write_signal(request, "check")
        if _is_ajax(request):
            return JsonResponse({"ok": ok})
        if ok:
            messages.info(request, "Checking version — reload shortly.")
        return redirect(_safe_next(request))


@method_decorator(staff_member_required, name="dispatch")
class DeployStatusView(View):
    """Returns version.json + status.json as JSON — for the live polling of the
    admin panel (no manual reload)."""

    def get(self, request):
        return JsonResponse({"version": _read_json("version.json"), "status": _read_json("status.json")})
