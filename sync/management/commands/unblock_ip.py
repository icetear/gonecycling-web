"""Management command to unblock (or list) IPs of the brute-force protection.

Examples:
    python manage.py unblock_ip 203.0.113.7      # unblock this IP
    python manage.py unblock_ip --list           # show blocked IPs
    python manage.py unblock_ip --all            # unblock/reset all IPs
"""
from django.core.management.base import BaseCommand, CommandError

from sync.models import BlockedIP


class Command(BaseCommand):
    help = "Unblocks one (or all) source IP(s) blocked by the brute-force protection."

    def add_arguments(self, parser):
        parser.add_argument("ip", nargs="?", help="IP address to unblock.")
        parser.add_argument("--list", action="store_true", help="Show blocked IPs.")
        parser.add_argument("--all", action="store_true", help="Remove all entries.")

    def handle(self, *args, **options):
        if options["list"]:
            blocked = BlockedIP.objects.filter(blocked=True)
            if not blocked:
                self.stdout.write("No blocked IPs.")
            for record in blocked:
                self.stdout.write(f"{record.ip}  (since {record.blocked_at}, {record.failures} failed attempts)")
            return

        if options["all"]:
            count = BlockedIP.objects.count()
            BlockedIP.objects.all().delete()
            self.stdout.write(self.style.SUCCESS(f"{count} entries removed."))
            return

        ip = options["ip"]
        if not ip:
            raise CommandError("Please specify an IP — or use --list / --all.")
        deleted, _ = BlockedIP.objects.filter(ip=ip).delete()
        if deleted:
            self.stdout.write(self.style.SUCCESS(f"IP {ip} unblocked."))
        else:
            self.stdout.write(f"IP {ip} was not blocked.")
