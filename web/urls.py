"""URL routes of the frontend."""
from django.urls import path

from .views import CheckVersionView, DeployStatusView, DeployView, HomeView

urlpatterns = [
    path("", HomeView.as_view(), name="home"),
    # Operator (staff/superuser only) — only write watcher signals.
    path("deploy/", DeployView.as_view(), name="deploy"),
    path("check-version/", CheckVersionView.as_view(), name="check_version"),
    path("deploy-status/", DeployStatusView.as_view(), name="deploy_status"),
]
