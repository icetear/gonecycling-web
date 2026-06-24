"""App configuration of the optional user accounts ("upgrade")."""
from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "accounts"
    verbose_name = "User accounts (upgrade)"
