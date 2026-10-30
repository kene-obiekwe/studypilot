import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in ("true", "1")


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return int(value.strip())


def env_list(name: str, default: list[str]) -> list[str]:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return [item.strip() for item in value.split(",") if item.strip()]


DEBUG = env_bool("DEBUG", False)

SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured(
            "SECRET_KEY is not set. Set the SECRET_KEY environment variable to a long random value "
            "when DEBUG is False."
        )
    SECRET_KEY = "unsafe-dev-key-do-not-use-in-production"

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", ["127.0.0.1", "localhost"])
# Render sets this to the service's onrender.com hostname, so the first deploy works before ALLOWED_HOSTS is set.
RENDER_EXTERNAL_HOSTNAME = os.getenv("RENDER_EXTERNAL_HOSTNAME", "").strip()
if RENDER_EXTERNAL_HOSTNAME and RENDER_EXTERNAL_HOSTNAME not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)

DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"] if DEBUG else []
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", DEV_ORIGINS)
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", DEV_ORIGINS)
CORS_EXPOSE_HEADERS = ["Retry-After"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "apps.users",
    "apps.planner",
    "apps.recommendations",
    "apps.tracking",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DB_ENGINE = os.getenv("DB_ENGINE", "sqlite").lower()
if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            # Modest, because Neon scales to zero and drops idle connections; health checks replace dead ones.
            conn_max_age=60,
            conn_health_checks=True,
            # sslmode is a PostgreSQL option; SQLite rejects it.
            ssl_require=not DEBUG and not DATABASE_URL.startswith("sqlite"),
        )
    }
elif DB_ENGINE == "postgres":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("DB_NAME", "fyp_db"),
            "USER": os.getenv("DB_USER", "fyp_user"),
            "PASSWORD": os.getenv("DB_PASSWORD", "fyp_pass"),
            "HOST": os.getenv("DB_HOST", "127.0.0.1"),
            "PORT": os.getenv("DB_PORT", "5432"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

if DEBUG or "test" in sys.argv:
    # Per-process memory cache: no table to create for development or the test runner.
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
else:
    # Shared across workers and restarts, so throttle counters and AI call budgets hold in production.
    # Create the table once with `manage.py createcachetable`. Each throttled key is a row, hence the headroom.
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "LOCATION": "django_cache",
            "OPTIONS": {"MAX_ENTRIES": 10000},
        }
    }

if "test" in sys.argv:
    # Fast hasher for the test runner only; dev and production keep Django's default hashers.
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

ADHERENCE_MODEL_PATH = Path(
    os.getenv("ADHERENCE_MODEL_PATH", "ml/models/oulad_adherence_forecast.joblib")
)
if not ADHERENCE_MODEL_PATH.is_absolute():
    ADHERENCE_MODEL_PATH = BASE_DIR / ADHERENCE_MODEL_PATH

# Optional AI-written study plans and trait suggestions. On only when ANTHROPIC_API_KEY is set;
# the SDK reads the key from the environment itself, so it is never stored in settings.
AI_PLAN_ENABLED = bool(os.getenv("ANTHROPIC_API_KEY", "").strip())
AI_PLAN_MODEL = os.getenv("AI_PLAN_MODEL", "").strip() or "claude-haiku-5-5"
AI_PLAN_DAILY_LIMIT = int(os.getenv("AI_PLAN_DAILY_LIMIT", "").strip() or 20)
AI_PLAN_TIMEOUT_SECONDS = float(os.getenv("AI_PLAN_TIMEOUT_SECONDS", "").strip() or 20)

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "").strip() or (
    "django.core.mail.backends.console.EmailBackend"
    if DEBUG
    else "django.core.mail.backends.smtp.EmailBackend"
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "").strip() or "localhost"
EMAIL_PORT = env_int("EMAIL_PORT", 587)
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
# Seconds before a stuck SMTP connection is abandoned, so a request is not held until the server timeout.
EMAIL_TIMEOUT = env_int("EMAIL_TIMEOUT", 10)
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "").strip() or "StudyPilot <no-reply@localhost>"
# Send code emails from a background thread after the request's transaction commits, so no request waits on
# SMTP and a known address answers as fast as an unknown one. Off under the test runner, which stays synchronous.
EMAIL_SEND_IN_BACKGROUND = env_bool("EMAIL_SEND_IN_BACKGROUND", "test" not in sys.argv)

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# How many reverse proxies sit in front of the app. Unset, DRF uses the whole X-Forwarded-For value as the
# throttle ident, so a client can dodge the throttles by sending a made-up header. Behind Render set it
# and check it with the steps in docs/deploy.md. Too low keys the throttle on a proxy's address, which changes per
# request behind Render, so the limit stops working; too high trusts an entry the client supplied.
_num_proxies = os.getenv("NUM_PROXIES", "").strip()
NUM_PROXIES = int(_num_proxies) if _num_proxies else None

REST_FRAMEWORK = {
    "NUM_PROXIES": NUM_PROXIES,
    "DEFAULT_THROTTLE_RATES": {
        "auth": os.getenv("AUTH_THROTTLE_RATE", "").strip() or "10/minute",
        "email": os.getenv("EMAIL_THROTTLE_RATE", "").strip() or "5/hour",
        # Counted only when a model call is about to be made (cache hits and rules-only plans are free).
        "ai_plan": f"{AI_PLAN_DAILY_LIMIT}/day",
    },
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_ACCESS_MINUTES", "30"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.getenv("JWT_REFRESH_DAYS", "1"))),
}

# The host's health check calls over plain HTTP and must not be redirected to HTTPS.
SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000"))
    # The API host has no subdomains, so including them changes nothing.
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = False
    # A subdomain of onrender.com can't be put on the browsers' HSTS preload list, so that check never applies.
    SILENCED_SYSTEM_CHECKS = ["security.W021"]
    SECURE_REFERRER_POLICY = "same-origin"

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    # 4xx responses are client errors, not operator warnings; 5xx still log at ERROR.
    "loggers": {"django.request": {"level": "ERROR"}},
}

# Error tracking (Sentry). Off unless SENTRY_DSN is set, and never started by the test runner. Errors only:
# see apps/common/monitoring.py for what is and is not sent.
SENTRY_DSN = os.getenv("SENTRY_DSN", "").strip()
SENTRY_ENVIRONMENT = os.getenv("SENTRY_ENVIRONMENT", "").strip() or ("development" if DEBUG else "production")
SENTRY_TRACES_SAMPLE_RATE = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "").strip() or 0)
if SENTRY_DSN and "test" not in sys.argv:
    from apps.common.monitoring import init_sentry

    init_sentry(
        SENTRY_DSN,
        environment=SENTRY_ENVIRONMENT,
        release=os.getenv("RENDER_GIT_COMMIT", "").strip() or None,
        traces_sample_rate=SENTRY_TRACES_SAMPLE_RATE,
    )
