from django.apps import AppConfig


class SyncConfig(AppConfig):
    """App configuration for the sync area (pairing + blob storage)."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "sync"
    verbose_name = "GoneCycling Sync"
