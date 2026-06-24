"""Endpoints of the user accounts ("upgrade" path).

Session/CSRF-based (Django's ``auth``), deliberately separate from the token-based
sync API (``/api/v1``). All responses are JSON; the frontend
(``static/js/accounts.js``) calls these endpoints with the CSRF token from the
cookie. The activation page (``activate``) is the only HTML response, because
it is opened directly from the mail link in the browser.

Routes (mounted under ``/accounts/``):

==========================  ======  ==================================================
Endpoint                    Method  Purpose
==========================  ======  ==================================================
``/register``               POST    Create profile (inactive) + activation mail
``/activate/<token>``       GET     Activation link from the mail → activate profile
``/login``                  POST    Sign in (only confirmed profiles)
``/logout``                 POST    Sign out
``/me``                     GET     Currently signed-in profile (state determination)
``/resend``                 POST    Resend activation mail
==========================  ======  ==================================================
"""
import json

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import User
from django.core import signing
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import transaction
from django.http import JsonResponse
from django.shortcuts import render
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import ensure_csrf_cookie

from sync.auth import hash_token
from sync.models import Vault

from .models import Profile

#: Salt of the signed, **stateless** activation token (no dedicated token model).
ACTIVATION_SALT = "accounts.activation"
#: Lifetime of the activation link in seconds (default 3 days, via ENV).
ACTIVATION_MAX_AGE = settings.ACCOUNT_ACTIVATION_MAX_AGE
#: Salt + lifetime of the password reset token (own salt → an
#: activation token is no good as a reset token and vice versa).
PASSWORD_RESET_SALT = "accounts.password-reset"
PASSWORD_RESET_MAX_AGE = settings.ACCOUNT_PASSWORD_RESET_MAX_AGE
#: Minimum password length (simple hurdle; real policy possibly later via
#: AUTH_PASSWORD_VALIDATORS).
MIN_PASSWORD_LENGTH = 8


# --- Helper functions -------------------------------------------------------

def _json(request) -> dict:
    """JSON body as ``dict`` (empty ``dict`` for a missing/invalid body)."""
    try:
        data = json.loads(request.body or b"{}")
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}


def _profile_payload(user: User) -> dict:
    """Public profile fields for JSON responses (without password/hash)."""
    return {"email": user.email, "first_name": user.first_name, "last_name": user.last_name}


def _activation_token(user: User) -> str:
    """Generate a signed activation token (contains only the user PK)."""
    return signing.dumps(user.pk, salt=ACTIVATION_SALT)


def _send_activation_mail(request, user: User) -> None:
    """Send the activation mail with an absolute link (incl. reverse-proxy subpath)."""
    link = request.build_absolute_uri(reverse("accounts:activate", args=[_activation_token(user)]))
    send_mail(
        subject="GoneCycling: Confirm your profile",
        message=(
            f"Hi {user.first_name},\n\n"
            f"please confirm your GoneCycling profile via this link:\n\n{link}\n\n"
            f"The link is valid for {ACTIVATION_MAX_AGE // 86400} days. "
            f"If you didn't create a profile, please ignore this email.\n"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )


def _password_reset_token(user: User) -> str:
    """Generate a signed password reset token (contains only the user PK)."""
    return signing.dumps(user.pk, salt=PASSWORD_RESET_SALT)


def _send_password_reset_mail(request, user: User) -> None:
    """Send mail with a password reset link (server-rendered form page)."""
    link = request.build_absolute_uri(
        reverse("accounts:password_reset_confirm", args=[_password_reset_token(user)])
    )
    send_mail(
        subject="GoneCycling: Reset your password",
        message=(
            f"Hi {user.first_name},\n\n"
            f"reset your GoneCycling password via this link:\n\n{link}\n\n"
            f"The link is valid for {PASSWORD_RESET_MAX_AGE // 60} minutes. "
            f"If you didn't request this, please ignore this email — your "
            f"password then stays unchanged.\n"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
    )


# --- Views ------------------------------------------------------------------

class RegisterView(View):
    """Create profile: creates an **inactive** ``User`` + ``Profile`` and
    sends the activation mail. The account only becomes active via the mail link.

    Expects JSON: ``{email, first_name, last_name, password, master_secret,
    auth_token?}``. ``master_secret`` is the base64url code of the current
    connection (upgrade), ``auth_token`` the bearer token derived from it for
    the optional vault binding.
    """

    def post(self, request):
        data = _json(request)
        email = (data.get("email") or "").strip().lower()
        first_name = (data.get("first_name") or "").strip()
        last_name = (data.get("last_name") or "").strip()
        password = data.get("password") or ""
        master_secret = (data.get("master_secret") or "").strip()
        auth_token = (data.get("auth_token") or "").strip()

        try:
            validate_email(email)
        except ValidationError:
            return JsonResponse({"detail": "Invalid email address."}, status=400)
        if not first_name or not last_name:
            return JsonResponse({"detail": "First and last name are required."}, status=400)
        if len(password) < MIN_PASSWORD_LENGTH:
            return JsonResponse(
                {"detail": f"Password too short (at least {MIN_PASSWORD_LENGTH} characters)."},
                status=400,
            )
        if not master_secret:
            return JsonResponse(
                {"detail": "Not connected — please connect with the app first."}, status=400
            )

        # Email = login identifier (``username``). Uniqueness via ``username``.
        if User.objects.filter(username=email).exists():
            return JsonResponse(
                {"detail": "A profile already exists for this email."}, status=409
            )

        # Optional vault binding: hash of the derived token (same identity
        # as in the sync, ``sync.auth.hash_token``) — no reimplementation of the crypto in Python.
        vault = None
        if auth_token:
            vault, _ = Vault.objects.get_or_create(token_hash=hash_token(auth_token))

        with transaction.atomic():
            user = User.objects.create_user(
                username=email,
                email=email,
                password=password,
                first_name=first_name,
                last_name=last_name,
                is_active=False,  # only active after mail confirmation
            )
            Profile.objects.create(user=user, vault=vault, master_secret=master_secret)

        # Sending outside the transaction: if it fails, the (inactive)
        # user remains and the user can use "resend".
        _send_activation_mail(request, user)
        return JsonResponse({"detail": "Confirmation email sent.", "email": email}, status=201)


class ActivateView(View):
    """Activation link from the mail (GET). Sets ``is_active=True`` and shows a
    small HTML confirmation page with a back link to the app (``/?login=1``)."""

    def get(self, request, token):
        ctx = {"base_path": settings.BASE_PATH}
        try:
            user_pk = signing.loads(token, salt=ACTIVATION_SALT, max_age=ACTIVATION_MAX_AGE)
        except signing.SignatureExpired:
            return render(request, "accounts/activation_invalid.html", {**ctx, "reason": "expired"}, status=400)
        except signing.BadSignature:
            return render(request, "accounts/activation_invalid.html", {**ctx, "reason": "invalid"}, status=400)

        user = User.objects.filter(pk=user_pk).first()
        if user is None:
            return render(request, "accounts/activation_invalid.html", {**ctx, "reason": "invalid"}, status=400)

        already = user.is_active
        if not already:
            user.is_active = True
            user.save(update_fields=["is_active"])
        return render(request, "accounts/activated.html", {**ctx, "already": already})


class LoginView(View):
    """Sign in with email + password. On success returns the profile **including**
    ``master_secret``, so that the client can automatically (re-)connect and
    decrypt the trips."""

    def post(self, request):
        data = _json(request)
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""

        # ``authenticate`` automatically rejects inactive users (returns ``None``).
        user = authenticate(request, username=email, password=password)
        if user is None:
            # Differentiated hint only if the account exists AND the password
            # is correct but activation is missing — otherwise generic (no account
            # enumeration on a wrong password).
            pending = User.objects.filter(username=email, is_active=False).first()
            if pending is not None and pending.check_password(password):
                return JsonResponse(
                    {"detail": "Please confirm your profile by email first.", "reason": "inactive"},
                    status=403,
                )
            return JsonResponse({"detail": "Email or password incorrect."}, status=401)

        login(request, user)
        profile = getattr(user, "profile", None)
        payload = _profile_payload(user)
        payload["master_secret"] = profile.master_secret if profile else ""
        return JsonResponse(payload, status=200)


class LogoutView(View):
    """Sign out (end session)."""

    def post(self, request):
        logout(request)
        return JsonResponse({"detail": "Signed out."}, status=200)


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(View):
    """Returns the currently signed-in **app profile** (or ``authenticated:false``).

    Called when the page loads to determine the navbar state, and
    at the same time sets the CSRF cookie for the subsequent POSTs. Logged-in
    operator admins (without ``Profile``) do NOT count as an app account here.
    """

    def get(self, request):
        user = request.user
        profile = getattr(user, "profile", None) if user.is_authenticated else None
        if profile is None:
            return JsonResponse({"authenticated": False}, status=200)
        payload = _profile_payload(user)
        payload["authenticated"] = True
        payload["master_secret"] = profile.master_secret
        return JsonResponse(payload, status=200)


class ResendView(View):
    """Resend activation mail. Always responds with 200 (no enumeration:
    it is not revealed whether the email exists)."""

    def post(self, request):
        data = _json(request)
        email = (data.get("email") or "").strip().lower()
        user = User.objects.filter(username=email, is_active=False).first()
        if user is not None:
            _send_activation_mail(request, user)
        return JsonResponse(
            {"detail": "If an unconfirmed profile exists, the email has been resent."},
            status=200,
        )


class PasswordResetRequestView(View):
    """"Forgot password": sends a reset link. Always responds with 200
    (no account enumeration). Affects only **active** accounts; the ``master_secret``
    stays unaffected (password = login credential, not the enc key)."""

    def post(self, request):
        data = _json(request)
        email = (data.get("email") or "").strip().lower()
        user = User.objects.filter(username=email, is_active=True).first()
        if user is not None:
            _send_password_reset_mail(request, user)
        return JsonResponse(
            {"detail": "If an account exists, a reset link has been sent."},
            status=200,
        )


class PasswordResetConfirmView(View):
    """Reset link from the mail. GET shows a small HTML form page (new
    password + confirmation), POST sets the password. Both validate the
    signed token; on an invalid/expired token there is an error page.

    Deliberately server-rendered (no SPA): the form carries ``{% csrf_token %}``
    and posts back to the same URL — Django's CSRF protection works normally.
    """

    template = "accounts/password_reset_confirm.html"

    def _load_user(self, token):
        """User from a valid token, otherwise ``None`` (expired/tampered)."""
        try:
            user_pk = signing.loads(token, salt=PASSWORD_RESET_SALT, max_age=PASSWORD_RESET_MAX_AGE)
        except signing.BadSignature:
            return None
        return User.objects.filter(pk=user_pk, is_active=True).first()

    def get(self, request, token):
        user = self._load_user(token)
        ctx = {"base_path": settings.BASE_PATH, "valid": user is not None, "token": token}
        return render(request, self.template, ctx, status=200 if user else 400)

    def post(self, request, token):
        user = self._load_user(token)
        ctx = {"base_path": settings.BASE_PATH, "valid": user is not None, "token": token}
        if user is None:
            return render(request, self.template, ctx, status=400)

        password = request.POST.get("password") or ""
        password2 = request.POST.get("password2") or ""
        if len(password) < MIN_PASSWORD_LENGTH:
            ctx["error"] = f"Password too short (at least {MIN_PASSWORD_LENGTH} characters)."
            return render(request, self.template, ctx, status=200)
        if password != password2:
            ctx["error"] = "The passwords do not match."
            return render(request, self.template, ctx, status=200)

        user.set_password(password)
        user.save(update_fields=["password"])
        return render(request, "accounts/password_reset_done.html", {"base_path": settings.BASE_PATH})


class PasswordChangeView(View):
    """Change password (logged in): current + new password. The running
    session is preserved via ``update_session_auth_hash`` (otherwise Django
    would sign the user out after the change).

    In the classic account model **no** re-wrap of the enc key is needed: the
    ``master_secret`` is held independently server-side and is **not** derived
    from the password — the password change only affects the login credential,
    not access to the encrypted trips.
    """

    def post(self, request):
        user = request.user
        if not user.is_authenticated or getattr(user, "profile", None) is None:
            return JsonResponse({"detail": "Not signed in."}, status=403)

        data = _json(request)
        old_password = data.get("old_password") or ""
        new_password = data.get("new_password") or ""
        if not user.check_password(old_password):
            return JsonResponse({"detail": "Current password incorrect."}, status=400)
        if len(new_password) < MIN_PASSWORD_LENGTH:
            return JsonResponse(
                {"detail": f"Password too short (at least {MIN_PASSWORD_LENGTH} characters)."},
                status=400,
            )

        user.set_password(new_password)
        user.save(update_fields=["password"])
        update_session_auth_hash(request, user)  # do not invalidate the session
        return JsonResponse({"detail": "Password changed."}, status=200)


class DeleteProfileView(View):
    """Deletes the user's own account (Django ``User`` incl. ``Profile``) and
    signs them out.

    The bound vault is **deliberately kept**: its ciphertext (the synced trips)
    stays reachable anonymously via the token — the zero-knowledge sync core is
    untouched. The vault binding is released automatically by ``Profile.vault``'s
    ``on_delete=SET_NULL``; PII (name/email) and the server-side ``master_secret``
    disappear together with the user/profile.

    Requires an active account session (CSRF-protected like all POSTs here); the
    "really delete?" confirmation happens in the frontend.
    """

    def post(self, request):
        user = request.user
        if not user.is_authenticated or getattr(user, "profile", None) is None:
            return JsonResponse({"detail": "Not signed in."}, status=403)
        logout(request)  # end the session while the user still exists
        user.delete()  # cascade deletes the profile too; the vault stays (SET_NULL)
        return JsonResponse({"detail": "Profile deleted."}, status=200)
