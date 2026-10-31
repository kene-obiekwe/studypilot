from django.contrib.auth.models import User
from rest_framework.test import APITestCase

URL = "/api/users/me/"


class MeEndpointTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="pilot_person", email="pilot@example.com", password="TestPass123!")
        User.objects.create_user(username="someone_else", email="else@example.com", password="TestPass123!")

    def test_requires_authentication(self):
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_returns_only_the_callers_identity(self):
        self.client.force_authenticate(self.user)
        response = self.client.get(URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data,
            {"id": self.user.id, "username": "pilot_person", "email": "pilot@example.com", "time_zone": None, "time_zone_auto": True},
        )

    def test_only_get_and_patch_are_allowed(self):
        self.client.force_authenticate(self.user)
        for method in ("post", "put", "delete"):
            self.assertEqual(getattr(self.client, method)(URL, {}, format="json").status_code, 405, method)
