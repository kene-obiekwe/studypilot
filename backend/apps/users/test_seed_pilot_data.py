import os
from io import StringIO
from unittest import mock

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

STRONG = "Quartz-Meadow-4471"
WEAK = "password123"


def run_seed(*args, env=None):
    """Run the seeder with a controlled PILOT_PASSWORD; return what it printed."""
    out = StringIO()
    environ = {key: value for key, value in os.environ.items() if key != "PILOT_PASSWORD"}
    environ.update(env or {})
    with mock.patch.dict(os.environ, environ, clear=True):
        call_command("seed_pilot_data", *args, stdout=out)
    return out.getvalue()


class SeedPilotDataGuardTests(TestCase):
    def assert_nothing_seeded(self):
        self.assertFalse(User.objects.filter(username__startswith="pilot_").exists())

    @override_settings(DEBUG=False)
    def test_refuses_in_production_without_the_flag(self):
        with self.assertRaisesMessage(CommandError, "--allow-production"):
            run_seed(env={"PILOT_PASSWORD": STRONG})
        self.assert_nothing_seeded()

    @override_settings(DEBUG=False)
    def test_flag_without_a_password_is_refused(self):
        with self.assertRaisesMessage(CommandError, "PILOT_PASSWORD"):
            run_seed("--allow-production")
        self.assert_nothing_seeded()

    @override_settings(DEBUG=False)
    def test_flag_with_an_empty_password_is_refused(self):
        with self.assertRaises(CommandError):
            run_seed("--allow-production", env={"PILOT_PASSWORD": ""})
        self.assert_nothing_seeded()

    @override_settings(DEBUG=False)
    def test_flag_with_a_weak_password_is_refused_and_never_echoed(self):
        with self.assertRaises(CommandError) as raised:
            run_seed("--allow-production", env={"PILOT_PASSWORD": WEAK})
        self.assertIn("too weak", str(raised.exception))
        self.assertNotIn(WEAK, str(raised.exception))
        self.assert_nothing_seeded()

    @override_settings(DEBUG=False)
    def test_a_password_similar_to_a_pilot_username_is_refused(self):
        with self.assertRaisesMessage(CommandError, "too similar"):
            run_seed("--allow-production", env={"PILOT_PASSWORD": "pilot_consistent9"})
        self.assert_nothing_seeded()

    @override_settings(DEBUG=False)
    def test_flag_with_a_strong_password_seeds_and_the_user_can_sign_in(self):
        output = run_seed("--allow-production", env={"PILOT_PASSWORD": STRONG})
        self.assertEqual(User.objects.filter(username__startswith="pilot_").count(), 5)
        self.assertIsNotNone(authenticate(username="pilot_consistent", password=STRONG))
        self.assertIsNone(authenticate(username="pilot_consistent", password="Pilot12345!"))
        self.assertIn("from PILOT_PASSWORD", output)
        self.assertNotIn(STRONG, output)


class SeedPilotDataDevelopmentTests(TestCase):
    @override_settings(DEBUG=True)
    def test_debug_default_still_works(self):
        output = run_seed()
        self.assertEqual(User.objects.filter(username__startswith="pilot_").count(), 5)
        self.assertIsNotNone(authenticate(username="pilot_consistent", password="Pilot12345!"))
        self.assertIn("from dev default", output)
        self.assertNotIn("Pilot12345!", output)

    @override_settings(DEBUG=True)
    def test_debug_uses_pilot_password_when_set(self):
        output = run_seed(env={"PILOT_PASSWORD": STRONG})
        self.assertIsNotNone(authenticate(username="pilot_average", password=STRONG))
        self.assertIsNone(authenticate(username="pilot_average", password="Pilot12345!"))
        self.assertIn("from PILOT_PASSWORD", output)
        self.assertNotIn(STRONG, output)
