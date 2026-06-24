from django.apps import AppConfig


class WebConfig(AppConfig):
    """Frontend app: serves the planner UI (map view)."""

    default_auto_field = "django.db.models.BigAutoField"
    name = "web"
    verbose_name = "GoneCycling Web (planner frontend)"
