"""Management command: sends a test email via the configured backend.

Used to verify the **production SMTP configuration** (``EMAIL_*`` in the ``.env``)
before real users register — because registration and password reset send
mails. With the default backend (console) the mail only lands in the log.

Example:
    python manage.py send_test_email mario@example.org
"""
from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Sends a test email via the configured email backend (SMTP check)."

    def add_arguments(self, parser):
        parser.add_argument("recipient", help="Recipient address of the test email.")

    def handle(self, *args, **options):
        recipient = options["recipient"]
        # Show the active configuration so the operator immediately sees whether
        # SMTP (instead of console) is being used at all.
        self.stdout.write(f"Backend: {settings.EMAIL_BACKEND}")
        self.stdout.write(f"From:    {settings.DEFAULT_FROM_EMAIL}")
        if settings.EMAIL_HOST:
            self.stdout.write(
                f"Host:    {settings.EMAIL_HOST}:{settings.EMAIL_PORT} (TLS={settings.EMAIL_USE_TLS})"
            )

        try:
            sent = send_mail(
                subject="GoneCycling: Test email",
                message=(
                    "This is a test email from GoneCycling.\n\n"
                    "If you receive it, email delivery (profile activation, "
                    "password reset) is configured correctly.\n"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[recipient],
                fail_silently=False,
            )
        except Exception as error:  # report SMTP errors to the operator in an understandable way
            raise CommandError(f"Sending failed: {error}") from error

        if not sent:
            raise CommandError("No email was sent (send_mail returned 0).")
        self.stdout.write(self.style.SUCCESS(f"Test email sent to {recipient}."))
