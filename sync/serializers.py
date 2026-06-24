"""DRF serializer for upload validation.

The server treats the blob as opaque ciphertext; only the transport
format (valid Base64) and the size are validated.
"""
import base64
import binascii

from django.conf import settings
from rest_framework import serializers


class BlobUploadSerializer(serializers.Serializer):
    """Input for ``PUT /blobs/<namespace>``."""

    #: Base64-encoded ciphertext (encrypted by the client).
    ciphertext = serializers.CharField(trim_whitespace=False)
    #: Schema version of the decrypted content (maintained by the client).
    content_version = serializers.IntegerField(min_value=1, default=1)
    #: Optional base revision for optimistic concurrency control.
    #: If it is sent and does not match the current one → 409.
    base_revision = serializers.IntegerField(min_value=0, required=False)

    def validate(self, attrs):
        try:
            raw = base64.b64decode(attrs["ciphertext"], validate=True)
        except (binascii.Error, ValueError):
            raise serializers.ValidationError({"ciphertext": "Not valid Base64."}) from None
        if not raw:
            raise serializers.ValidationError({"ciphertext": "Empty blob."})
        if len(raw) > settings.SYNC_MAX_BLOB_BYTES:
            raise serializers.ValidationError(
                {"ciphertext": f"Blob too large (> {settings.SYNC_MAX_BLOB_BYTES} bytes)."}
            )
        # Pass the decoded bytes through to the view (no second decoding).
        attrs["ciphertext_bytes"] = raw
        return attrs
