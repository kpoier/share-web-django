import os
from pathlib import Path

# === 1. Core Configuration ===
BASE_DIR = Path(__file__).resolve().parent.parent

# 優先讀取環境變數，若無則使用預設值
SECRET_KEY = os.environ.get("SECRET_KEY", "django-insecure-yn=p++uep^rbian^a3@%l#v%-hlu%wiv=j7pc_&w&@cbr01nhb")

DEBUG = False

ALLOWED_HOSTS = ["*"]

# [修改] 從環境變數讀取 CSRF 設定
# 邏輯：讀取字串 -> 用逗號切割 -> 去除空白 -> 過濾掉空字串
csrf_trusted_origins_env = os.environ.get("CSRF_TRUSTED_ORIGINS", "")

if csrf_trusted_origins_env:
    CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in csrf_trusted_origins_env.split(",") if origin.strip()]
else:
    CSRF_TRUSTED_ORIGINS = []

# === 2. Applications & Middleware ===
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "core",  # Your App
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",  # Static files optimization
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
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# === 3. Database ===
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

# === 4. Password Validation ===
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# === 5. Internationalization ===
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Taipei"
USE_I18N = True
USE_TZ = True

# === 6. Static & Media Files ===
STATIC_URL = "static/"
# 收集靜態檔的目的地 (Docker/Production)
STATIC_ROOT = BASE_DIR / "staticfiles"

# 開發時的靜態檔來源
STATICFILES_DIRS = [
    BASE_DIR / "core/static",
]

# WhiteNoise 儲存引擎 (壓縮與快取)
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# 上傳檔案設定
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "uploads"

# === 7. Others ===
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# 分片上傳的暫存目錄
FILE_UPLOAD_TEMP_DIR = os.path.join(MEDIA_ROOT, 'temp_chunks')

if not os.path.exists(FILE_UPLOAD_TEMP_DIR):
    os.makedirs(FILE_UPLOAD_TEMP_DIR)