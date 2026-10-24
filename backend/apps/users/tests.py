from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import override_settings
from rest_framework.settings import api_settings
from rest_framework.test import APITestCase

from .verification import is_verified, mark_verified


class RegistrationTests(APITestCase):
    url = "/api/users/register/"

    def setUp(self):
        cache.clear()  # throttle counters live in the cache

    def payload(self, **overrides):
        data = {"username": "newuser", "email": "newuser@example.com", "password": "StrongPass123!"}
        data.update(overrides)
        return data

    def test_register_success(self):
        response = self.client.post(self.url, self.payload(), format="json")
        self.assertEqual(response.status_code, 201)
        user = User.objects.get(username="newuser")
        self.assertEqual(response.data, {"status": "verification_required", "email": "newuser@example.com"})
        self.assertEqual(user.email, "newuser@example.com")
        self.assertTrue(user.check_password("StrongPass123!"))
        self.assertFalse(is_verified(user))

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
        cache.clear()  # throttle counters live in the cache
        self.user = User.objects.create_user(
            username="tokenuser", email="tokenuser@example.com", password="StrongPass123!"
        )
        mark_verified(self.user)

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


class PasswordValidatorTests(APITestCase):
    """Registration applies every rule in AUTH_PASSWORD_VALIDATORS."""

    url = "/api/users/register/"

    def setUp(self):
        cache.clear()

    def register(self, **overrides):
        data = {"username": "validator", "email": "validator@example.com", "password": "Sturdy-Pass-7391"}
        data.update(overrides)
        return self.client.post(self.url, data, format="json")

    def assert_password_rejected(self, password, **overrides):
        response = self.register(password=password, **overrides)
        self.assertEqual(response.status_code, 400, password)
        self.assertIn("password", response.data)
        self.assertFalse(User.objects.filter(username=overrides.get("username", "validator")).exists())
        return response

    def test_common_password_rejected(self):
        response = self.assert_password_rejected("password123")
        self.assertTrue(any("common" in message for message in response.data["password"]))

    def test_all_numeric_password_rejected(self):
        response = self.assert_password_rejected("8274619305")
        self.assertTrue(any("entirely numeric" in message for message in response.data["password"]))

    def test_password_similar_to_username_rejected(self):
        response = self.assert_password_rejected("kenekene99", username="kenekene")
        self.assertTrue(any("too similar" in message for message in response.data["password"]))

    def test_password_similar_to_email_rejected(self):
        self.assert_password_rejected("sophiaroberts1", username="sr", email="sophiaroberts@example.com")

    def test_several_failures_are_all_reported(self):
        response = self.register(password="12345678")
        self.assertEqual(response.status_code, 400)
        self.assertGreaterEqual(len(response.data["password"]), 2)

    def test_strong_password_accepted(self):
        response = self.register()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.get(username="validator").check_password("Sturdy-Pass-7391"))


class AuthThrottleTests(APITestCase):
    """register, token and token refresh share the "auth" throttle scope; other endpoints are unthrottled."""

    def setUp(self):
        cache.clear()
        self.limit = int(api_settings.DEFAULT_THROTTLE_RATES["auth"].split("/")[0])

    def tearDown(self):
        cache.clear()

    def assert_throttled_after_limit(self, url, payload):
        for attempt in range(self.limit):
            response = self.client.post(url, payload, format="json")
            self.assertNotEqual(response.status_code, 429, f"request {attempt + 1} was throttled early")
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)

    def test_register_is_throttled(self):
        # Register shares the "auth" bucket and also has the stricter "email" bucket; the smaller limit bites first.
        email_limit = int(api_settings.DEFAULT_THROTTLE_RATES["email"].split("/")[0])
        allowed = min(self.limit, email_limit)
        for attempt in range(allowed):
            response = self.client.post("/api/users/register/", {}, format="json")
            self.assertNotEqual(response.status_code, 429, f"request {attempt + 1} was throttled early")
        response = self.client.post("/api/users/register/", {}, format="json")
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)

    def test_token_obtain_is_throttled(self):
        self.assert_throttled_after_limit("/api/auth/token/", {"username": "nobody", "password": "wrong"})

    def test_token_refresh_is_throttled(self):
        self.assert_throttled_after_limit("/api/auth/token/refresh/", {"refresh": "not-a-token"})

    def test_throttled_request_is_rejected_even_with_valid_credentials(self):
        User.objects.create_user(username="throttled", password="Sturdy-Pass-7391")
        for _ in range(self.limit):
            self.client.post("/api/auth/token/", {"username": "throttled", "password": "wrong"}, format="json")
        good = self.client.post("/api/auth/token/", {"username": "throttled", "password": "Sturdy-Pass-7391"}, format="json")
        self.assertEqual(good.status_code, 429)

    @override_settings(CORS_ALLOWED_ORIGINS=["http://localhost:3000"])
    def test_throttled_response_exposes_retry_after_to_allowed_origins(self):
        origin = "http://localhost:3000"
        payload = {"username": "nobody", "password": "wrong"}
        for _ in range(self.limit):
            self.client.post("/api/auth/token/", payload, format="json", HTTP_ORIGIN=origin)
        response = self.client.post("/api/auth/token/", payload, format="json", HTTP_ORIGIN=origin)
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response.headers)
        self.assertEqual(response.headers["Access-Control-Allow-Origin"], origin)
        exposed = [name.strip().lower() for name in response.headers["Access-Control-Expose-Headers"].split(",")]
        self.assertIn("retry-after", exposed)

    def test_other_endpoints_are_not_throttled(self):
        user = User.objects.create_user(username="unthrottled", password="Sturdy-Pass-7391")
        self.client.force_authenticate(user=user)
        for _ in range(self.limit * 2):
            self.assertEqual(self.client.get("/api/tracking/history/").status_code, 200)
            self.assertEqual(self.client.get("/api/planner/history/").status_code, 200)


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
