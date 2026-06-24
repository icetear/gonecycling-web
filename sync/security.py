"""Brute-force protection for the sync API.

When someone repeatedly accesses a vault with an **unknown token hash** (wrong
token), the source IP is blocked after ``BRUTEFORCE_MAX_FAILURES``
failed attempts and the admin is notified by email. Blocked IPs
are rejected via the ``NotBlockedIP`` permission.

Important (IP behind the reverse proxy): ``REMOTE_ADDR`` is the proxy
(127.0.0.1). The real client IP is in the ``X-Forwarded-For``. With exactly one
trusted proxy (Apache/nginx) the **last** entry is the client IP as seen
by the proxy — spoofing-resistant (client-set entries are
to the left of it).
"""
import logging

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

from .models import BlockedIP

log = logging.getLogger("sync.security")


def client_ip(request) -> str:
    """Determine the real source IP (last X-Forwarded-For entry, otherwise REMOTE_ADDR)."""
    xff = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.META.get("REMOTE_ADDR", "") or "unknown"


def _max_failures() -> int:
    return int(getattr(settings, "BRUTEFORCE_MAX_FAILURES", 3))


def is_blocked(ip: str) -> bool:
    """Is this IP blocked?"""
    return BlockedIP.objects.filter(ip=ip, blocked=True).exists()


def register_success(ip: str) -> None:
    """Successful access (existing vault) → reset the IP's failed attempts
    (blocked IPs stay blocked — they don't reach the view anyway)."""
    BlockedIP.objects.filter(ip=ip, blocked=False).delete()


def register_failure(request, token_hash: str | None) -> bool:
    """Count one failed attempt (unknown hash) for the IP.

    If the counter reaches the limit, the IP is blocked and the admin is notified
    by email. Returns ``True`` if the IP is (now or already) blocked.
    """
    ip = client_ip(request)
    record, _ = BlockedIP.objects.get_or_create(ip=ip)
    if record.blocked:
        return True
    record.failures += 1
    record.last_failure_at = timezone.now()
    if record.failures >= _max_failures():
        record.blocked = True
        record.blocked_at = record.last_failure_at
        record.save(update_fields=["failures", "last_failure_at", "blocked", "blocked_at"])
        _notify_admin(ip, record.failures, token_hash)
        return True
    record.save(update_fields=["failures", "last_failure_at"])
    return False


def _notify_admin(ip: str, failures: int, token_hash: str | None) -> None:
    """Inform the admin about the block by email (email errors do not escalate)."""
    recipient = getattr(settings, "ADMIN_ALERT_EMAIL", "admin@example.com")
    subject = f"[GoneCycling] IP blocked: {ip}"
    body = (
        f"The IP {ip} was blocked after {failures} failed sync attempts with "
        f"an unknown token hash.\n\n"
        f"Hash prefix of the last attempt: {(token_hash or '')[:12]}…\n"
        f"Time: {timezone.now().isoformat()}\n\n"
        f"Unblock on the server:  python manage.py unblock_ip {ip}\n"
    )
    try:
        send_mail(
            subject,
            body,
            getattr(settings, "DEFAULT_FROM_EMAIL", None),
            [recipient],
            fail_silently=True,
        )
    except Exception:  # pragma: no cover - email must never crash the request
        log.exception("Admin notification could not be sent")


class NotBlockedIP(BasePermission):
    """Rejects blocked source IPs with "IP blocked." (403)."""

    def has_permission(self, request, view) -> bool:
        if is_blocked(client_ip(request)):
            raise PermissionDenied(detail="IP blocked.")
        return True
