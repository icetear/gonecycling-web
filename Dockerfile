FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip

# Dependencies first (better layer caching).
COPY requirements.txt requirements-prod.txt ./
RUN pip install --no-cache-dir -r requirements-prod.txt

COPY . .

# Collect static files — WITH DEBUG=False, so the hashed manifest delivery
# (CompressedManifestStaticFilesStorage) generates the staticfiles.json;
# otherwise a 500 at runtime. Dummy key only for this build step; at runtime
# the real DJANGO_SECRET_KEY comes from the environment.
RUN DJANGO_SECRET_KEY=build-time-dummy DEBUG=False python manage.py collectstatic --noinput

EXPOSE 8000

# Migrations + server. In production possibly behind a reverse proxy (Caddy/nginx).
CMD ["sh", "-c", "python manage.py migrate --noinput && gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3"]
