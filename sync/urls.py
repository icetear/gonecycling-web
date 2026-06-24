"""URL routes of the sync API (mounted under /api/v1/)."""
from django.urls import path, re_path

from . import views

urlpatterns = [
    path("health", views.HealthView.as_view(), name="health"),
    path("pair", views.PairView.as_view(), name="pair"),
    path("blobs", views.BlobManifestView.as_view(), name="blob-manifest"),
    # Namespace deliberately limited to a safe, short alphabet (e.g. "trips").
    re_path(r"^blobs/(?P<namespace>[a-z0-9_]{1,64})$", views.BlobView.as_view(), name="blob"),
    path("vault", views.VaultView.as_view(), name="vault"),
]
