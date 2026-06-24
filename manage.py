#!/usr/bin/env python
"""Django command-line entry point (manage.py).

Examples:
    python manage.py migrate
    python manage.py runserver
    pytest
"""
import os
import sys


def main() -> None:
    # Default settings module; overridable via environment variable.
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:  # pragma: no cover - only if Django is missing
        raise ImportError(
            "Django ist nicht installiert. Aktiviere das virtuelle Environment "
            "und führe `pip install -r requirements-dev.txt` aus."
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
