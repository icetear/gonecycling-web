"""Django settings for the GoneCycling sync backend.

Deliberately kept lean: the backend is an **anonymous, end-to-end
encrypted blob storage** (see README + `sync/`). There are no
user accounts, no sessions, no admin — the identity is solely the
hash of a client-generated bearer token. This keeps the app-wide
attack and GDPR surface minimal.

Configuration comes from environment variables (see `.env.example`); for
local development there are sensible defaults (SQLite, DEBUG=True).
"""
from pathlib import Path

import environ
from django.contrib.messages import constants as message_constants
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Read environment ----------------------------------------------------------
# `environ` reads .env (if present) and environment variables.
env = environ.Env()
# Only read .env if it exists (in production the values come from real
# environment variables).
env_file = BASE_DIR / ".env"
if env_file.exists():
    env.read_env(str(env_file))

# Local development runs without any environment variable: DEBUG=True + an
# insecure dev key. In production DEBUG=False **and** a real
# DJANGO_SECRET_KEY MUST be set (see guard below).
DEBUG = env.bool("DEBUG", default=True)
SECRET_KEY = env("DJANGO_SECRET_KEY", default="django-insecure-dev-only-change-me")

# Safety net: never start with the dev key in production.
if not DEBUG and SECRET_KEY.startswith("django-insecure"):
    raise ImproperlyConfigured(
        "In production (DEBUG=False) DJANGO_SECRET_KEY must be set to a real "
        "random value."
    )

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

# Behind a reverse proxy (Caddy/nginx) with TLS: trust the X-Forwarded-Proto.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Optional URL subpath under which the app runs behind a reverse proxy —
# e.g. GC_BASE_PATH=/gonecycling for https://host/gonecycling/. Empty = at the
# domain root. Affects URLconf (config/urls.py), STATIC_URL and the JS API base
# injected via template (window.GC_BASE_PATH → app.js). The proxy
# forwards the full path incl. prefix (no stripping needed).
_base = env("GC_BASE_PATH", default="").strip().strip("/")
BASE_PATH = f"/{_base}" if _base else ""

# --- Sessions / CSRF / admin login (operator only; sync stays token-based) ---
# Bind cookies to the subpath (no leak to /ors or similar) and in production
# secure them behind HTTPS. CSRF: mark the own origin as trusted.
SESSION_COOKIE_PATH = BASE_PATH or "/"
CSRF_COOKIE_PATH = BASE_PATH or "/"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
CSRF_TRUSTED_ORIGINS = env.list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    default=[f"https://{h}" for h in ALLOWED_HOSTS if h not in ("127.0.0.1", "localhost", "testserver")],
)
# Protected pages without login → admin login.
LOGIN_URL = "admin:login"

# Directory for the update signal (bind mount to the host watcher). The admin
# update page only writes a request here; the actual git pull +
# rebuild is done by a systemd watcher OUTSIDE the container.
DEPLOY_SIGNAL_DIR = env("DEPLOY_SIGNAL_DIR", default="/deploy")

# Map Django messages to Bootstrap alert classes (error → danger).
MESSAGE_TAGS = {message_constants.ERROR: "danger"}

# --- Apps -------------------------------------------------------------------
# The sync stays token-based + anonymous. Admin/auth serve only the operator
# (superuser login for the update button) and as the basis for later
# premium accounts — they do not touch the zero-knowledge sync.
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "sync",      # sync API (anonymous, zero-knowledge)
    "accounts",  # Optional user accounts ("upgrade": login/profile/mail confirmation)
    "web",       # Planner frontend (map view) + admin update page
]

# Sessions/auth/CSRF are needed for admin + update page; the token API
# (DRF, VaultTokenAuthentication) uses no sessions and is unaffected by this.
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "web.context_processors.deploy_info",
            ]
        },
    },
]

# --- Database ----------------------------------------------------------------
# Default: SQLite in the project folder. Production: DATABASE_URL=postgres://…
DATABASES = {
    "default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Static files (planner frontend) -------------------------------------------
# Absolute + possibly with subpath (reverse proxy), e.g. /gonecycling/static/.
STATIC_URL = f"{BASE_PATH}/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]

if DEBUG:
    # Development: WhiteNoise serves the files via the staticfiles finders,
    # so no `collectstatic` (and no manifest storage) needed.
    WHITENOISE_USE_FINDERS = True
    WHITENOISE_AUTOREFRESH = True
    STORAGES = {
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    }
else:
    # Production: compressed, hashed delivery (after `collectstatic`).
    STORAGES = {
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    }

# --- Django REST Framework --------------------------------------------------
REST_FRAMEWORK = {
    # Authentication exclusively via the anonymous vault token.
    "DEFAULT_AUTHENTICATION_CLASSES": ["sync.auth.VaultTokenAuthentication"],
    # By default a valid token is mandatory; individual views (health)
    # explicitly allow AllowAny. NotBlockedIP rejects blocked source IPs first.
    "DEFAULT_PERMISSION_CLASSES": [
        "sync.security.NotBlockedIP",
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "sync.throttling.VaultRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        # Protection against token guessing/spam (applies per IP resp. per vault).
        "anon": env("THROTTLE_ANON", default="60/min"),
        "vault": env("THROTTLE_VAULT", default="120/min"),
    },
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "UNAUTHENTICATED_USER": None,
}

# --- Sync-specific limits ---------------------------------------------------
# Maximum size of an (encrypted) blob in bytes. A trip/route
# collection as JSON is small; 8 MB is generous and limits abuse.
SYNC_MAX_BLOB_BYTES = env.int("SYNC_MAX_BLOB_BYTES", default=8 * 1024 * 1024)
# Request body limit a bit above the blob limit (Base64 inflates by ~33 %).
DATA_UPLOAD_MAX_MEMORY_SIZE = int(SYNC_MAX_BLOB_BYTES * 1.5)

# --- Brute-force protection + admin notification ----------------------------
# After this many accesses with an unknown token hash the source IP is blocked.
BRUTEFORCE_MAX_FAILURES = env.int("BRUTEFORCE_MAX_FAILURES", default=3)
# Recipient of the block notification.
ADMIN_ALERT_EMAIL = env("ADMIN_ALERT_EMAIL", default="admin@example.com")

# --- E-Mail ------------------------------------------------------------------
# Default = console (prints the mail to the log; works without SMTP). In
# production set real SMTP via the ENV (EMAIL_BACKEND=…smtp.EmailBackend).
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="gonecycling@example.com")

# --- User accounts ("upgrade") ----------------------------------------------
# Lifetime of the signed activation link in seconds (default 3 days).
ACCOUNT_ACTIVATION_MAX_AGE = env.int("ACCOUNT_ACTIVATION_MAX_AGE", default=3 * 24 * 3600)
# Lifetime of the password reset link in seconds (shorter, default 1 hour).
ACCOUNT_PASSWORD_RESET_MAX_AGE = env.int("ACCOUNT_PASSWORD_RESET_MAX_AGE", default=3600)

# --- Miscellaneous --------------------------------------------------------------
USE_TZ = True
TIME_ZONE = "UTC"
LANGUAGE_CODE = "en-us"
USE_I18N = False
