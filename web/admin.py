"""Extends the admin start page with the server update/version panel.

`web/admin.py` is imported by the admin autodiscovery; here we set the
index template of the default admin site to ``admin/gc_index.html`` (which
extends the real ``admin/index.html`` — own name → no recursion).
"""
from django.conf import settings
from django.contrib import admin

admin.site.index_template = "admin/gc_index.html"

# Point "View site" (top right in the admin) at the app root — under the
# reverse-proxy subpath that is e.g. /gonecycling/ instead of /.
admin.site.site_url = f"{settings.BASE_PATH}/" if settings.BASE_PATH else "/"

# Branding of the admin interface.
admin.site.site_header = "GoneCycling – Administration"
admin.site.site_title = "GoneCycling"
admin.site.index_title = "Administration"
