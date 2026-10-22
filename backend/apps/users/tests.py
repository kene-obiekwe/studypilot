from django.contrib.auth.models import User
from rest_framework.test import APITestCase


class RegistrationTests(APITestCase):
    url = "/api/users/register/"

    def payload(self, **overrides):
        data = {"username": "newuser", "email": "newuser@example.com", "password": "StrongPass123!"}
        data.update(overrides)
        return data

    def test_register_success(self):
        response = self.client.post(self.url, self.payload(), format="json")
        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username="newuser")
        self.assertEqual(response.data, {"id": user.id, "username": "newuser"})
        self.assertEqual(user.email, "newuser@example.com")
        self.assertTrue(user.check_password("StrongPass123!"))

    def test_register_does_not_echo_password(self):
        response = self.client.post(self.url, self.payload(), format="json")
        self.assertNotIn("password", response.data)

    def test_register_does_not_require_auth(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(self.url, self.payload(), format="json")
        self.assertEqual(response.status_code, 201)

    def test_duplicate_email_rejected(self):
        User.objects.create_user(username="existing", email="taken@example.com", password="StrongPass123!")
        response = self.client.post(self.url, self.payload(email="taken@example.com"), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)
        self.assertFalse(User.objects.filter(username="newuser").exists())

    def test_duplicate_email_rejected_case_insensitively(self):
        User.objects.create_user(username="existing", email="taken@example.com", password="StrongPass123!")
        response = self.client.post(self.url, self.payload(email="TAKEN@Example.com"), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_duplicate_username_rejected(self):
        User.objects.create_user(username="newuser", email="other@example.com", password="StrongPass123!")
        response = self.client.post(self.url, self.payload(), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("username", response.data)

    def test_short_password_rejected(self):
        response = self.client.post(self.url, self.payload(password="Ab1!xyz"), format="json")  # 7 chars
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data)
        self.assertFalse(User.objects.filter(username="newuser").exists())

    def test_eight_character_password_accepted(self):
        response = self.client.post(self.url, self.payload(password="Ab1!xyz9"), format="json")  # 8 chars
        self.assertEqual(response.status_code, 201)

    def test_invalid_email_rejected(self):
        response = self.client.post(self.url, self.payload(email="not-an-email"), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("email", response.data)

    def test_missing_fields_rejected(self):
        response = self.client.post(self.url, {}, format="json")
        self.assertEqual(response.status_code, 400)
        for field in ("username", "email", "password"):
            self.assertIn(field, response.data)


class TokenTests(APITestCase):
    obtain_url = "/api/auth/token/"
    refresh_url = "/api/auth/token/refresh/"

    def setUp(self):
        self.user = User.objects.create_user(
            username="tokenuser", email="tokenuser@example.com", password="StrongPass123!"
        )

    def obtain(self, **overrides):
        data = {"username": "tokenuser", "password": "StrongPass123!"}
        data.update(overrides)
        return self.client.post(self.obtain_url, data, format="json")

    def test_obtain_with_good_credentials(self):
        response = self.obtain()
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_obtain_with_wrong_password(self):
        response = self.obtain(password="WrongPass123!")
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("access", response.data)

    def test_obtain_with_unknown_user(self):
        response = self.obtain(username="nobody")
        self.assertEqual(response.status_code, 401)

    def test_access_token_authenticates_requests(self):
        access = self.obtain().data["access"]
        response = self.client.get("/api/tracking/history/", HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(response.status_code, 200)

    def test_refresh_returns_new_access_token(self):
        refresh = self.obtain().data["refresh"]
        response = self.client.post(self.refresh_url, {"refresh": refresh}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        follow_up = self.client.get(
            "/api/tracking/history/", HTTP_AUTHORIZATION=f"Bearer {response.data['access']}"
        )
        self.assertEqual(follow_up.status_code, 200)

    def test_refresh_with_invalid_token(self):
        response = self.client.post(self.refresh_url, {"refresh": "not-a-token"}, format="json")
        self.assertEqual(response.status_code, 401)

    def test_access_token_cannot_be_used_to_refresh(self):
        access = self.obtain().data["access"]
        response = self.client.post(self.refresh_url, {"refresh": access}, format="json")
        self.assertEqual(response.status_code, 401)


class ProtectedEndpointTests(APITestCase):
    """Every API endpoint except registration and token issue needs a bearer token."""

    protected = [
        ("get", "/api/planner/history/"),
        ("post", "/api/planner/generate/"),
        ("get", "/api/recommendations/history/"),
        ("post", "/api/recommendations/generate/"),
        ("get", "/api/tracking/history/"),
        ("get", "/api/tracking/training-data/"),
        ("post", "/api/tracking/session-log/"),
        ("post", "/api/tracking/predict/"),
    ]

    def test_return_401_without_token(self):
        for method, url in self.protected:
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, {}, format="json")
                self.assertEqual(response.status_code, 401)

    def test_return_401_with_garbage_token(self):
        for method, url in self.protected:
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(
                    url, {}, format="json", HTTP_AUTHORIZATION="Bearer not.a.token"
                )
                self.assertEqual(response.status_code, 401)
