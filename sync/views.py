"""API endpoints of the sync backend.

Overview (all under ``/api/v1/``):

==========================  ======  ==================================================
Endpoint                    Method  Purpose
==========================  ======  ==================================================
``/health``                 GET     Health check (without token)
``/pair``                   POST    Create/"greet" vault, return manifest
``/blobs``                  GET     Manifest: namespaces + revisions
``/blobs/<namespace>``      GET     Load ciphertext of a namespace
``/blobs/<namespace>``      PUT     Upload ciphertext (optimistic lock)
``/blobs/<namespace>``      DELETE  Delete a single namespace
``/vault``                  DELETE  Delete the entire vault (rotation/GDPR)
==========================  ======  ==================================================
"""
import base64

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SyncBlob, Vault
from .security import client_ip, register_failure, register_success
from .serializers import BlobUploadSerializer


def _b64(data) -> str:
    """Bytes/memoryview → Base64 string for the JSON response."""
    return base64.b64encode(bytes(data)).decode("ascii")


def _blob_meta(blob: SyncBlob) -> dict:
    """Metadata of a blob (without ciphertext) for manifests."""
    return {
        "namespace": blob.namespace,
        "content_version": blob.content_version,
        "revision": blob.revision,
        "updated_at": blob.updated_at.isoformat(),
    }


class HealthView(APIView):
    """Simple health check; deliberately without token/throttling."""

    authentication_classes: list = []
    permission_classes = [AllowAny]
    throttle_classes: list = []

    def get(self, request):
        return Response(
            {"status": "ok", "service": "gonecycling-sync", "time": timezone.now().isoformat()}
        )


class PairView(APIView):
    """Idempotent pairing.

    Creates the vault for the given token (if new) and returns a manifest
    of the existing namespaces. The web client calls this directly after the
    token is entered, to know what is already synced.
    """

    def post(self, request):
        vault, created = Vault.objects.get_or_create(token_hash=request.user.token_hash)
        register_success(client_ip(request))  # legitimate pairing → reset failed attempts
        return Response(
            {
                "paired": True,
                "created": created,
                "server_time": timezone.now().isoformat(),
                "namespaces": [_blob_meta(b) for b in vault.blobs.all()],
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class BlobManifestView(APIView):
    """List of namespaces + revisions (for the sync reconciliation)."""

    def get(self, request):
        vault = Vault.objects.filter(token_hash=request.user.token_hash).first()
        namespaces = [_blob_meta(b) for b in vault.blobs.all()] if vault else []
        return Response({"namespaces": namespaces, "server_time": timezone.now().isoformat()})


class BlobView(APIView):
    """Read/write/delete a single namespace blob."""

    def get(self, request, namespace):
        vault = Vault.objects.filter(token_hash=request.user.token_hash).first()
        if vault is None:
            # Unknown hash = possible brute-force attempt → count/possibly block.
            now_blocked = register_failure(request, request.user.token_hash)
            if now_blocked:
                return Response(
                    {"detail": "IP blocked.", "reason": "ip_blocked"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            return Response(
                {"detail": "Invalid access — unknown hash.", "reason": "hash_invalid"},
                status=status.HTTP_404_NOT_FOUND,
            )
        register_success(client_ip(request))  # valid vault → reset failed attempts
        blob = vault.blobs.filter(namespace=namespace).first()
        if blob is None:
            return Response({"detail": "Namespace not found."}, status=status.HTTP_404_NOT_FOUND)
        data = _blob_meta(blob)
        data["ciphertext"] = _b64(blob.ciphertext)
        return Response(data)

    def put(self, request, namespace):
        serializer = BlobUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        payload = serializer.validated_data

        # Write access creates the vault on demand (first-time sync).
        vault, _ = Vault.objects.get_or_create(token_hash=request.user.token_hash)
        register_success(client_ip(request))  # legitimate write access → reset failed attempts
        blob = vault.blobs.filter(namespace=namespace).first()

        base_revision = payload.get("base_revision")
        if blob is not None and base_revision is not None and base_revision != blob.revision:
            # Optimistic lock: the client edited on a stale
            # basis → conflict, it must reload/merge.
            return Response(
                {"detail": "Conflict: stale revision.", "current_revision": blob.revision},
                status=status.HTTP_409_CONFLICT,
            )

        if blob is None:
            blob = SyncBlob(vault=vault, namespace=namespace, revision=0)
        blob.ciphertext = payload["ciphertext_bytes"]
        blob.content_version = payload["content_version"]
        blob.revision += 1  # server-side incrementing
        blob.save()
        return Response(_blob_meta(blob), status=status.HTTP_200_OK)

    def delete(self, request, namespace):
        vault = Vault.objects.filter(token_hash=request.user.token_hash).first()
        if vault is not None:
            vault.blobs.filter(namespace=namespace).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class VaultView(APIView):
    """Delete the entire vault — for token rotation and GDPR deletion request."""

    def delete(self, request):
        Vault.objects.filter(token_hash=request.user.token_hash).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
