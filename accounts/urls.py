"""URL routes of the user accounts (mounted under ``/accounts/``)."""
from django.urls import path, re_path

from . import views

app_name = "accounts"

urlpatterns = [
    path("register", views.RegisterView.as_view(), name="register"),
    path("login", views.LoginView.as_view(), name="login"),
    path("logout", views.LogoutView.as_view(), name="logout"),
    path("me", views.MeView.as_view(), name="me"),
    path("resend", views.ResendView.as_view(), name="resend"),
    path("password/reset", views.PasswordResetRequestView.as_view(), name="password_reset"),
    path("password/change", views.PasswordChangeView.as_view(), name="password_change"),
    path("delete", views.DeleteProfileView.as_view(), name="delete"),
    # Activation/reset token: signed string (contains ':' among others), but never '/'.
    re_path(r"^activate/(?P<token>[^/]+)$", views.ActivateView.as_view(), name="activate"),
    re_path(
        r"^password/reset/confirm/(?P<token>[^/]+)$",
        views.PasswordResetConfirmView.as_view(),
        name="password_reset_confirm",
    ),
]
