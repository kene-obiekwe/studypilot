"""Course-trait suggestions: keyword map, AI path with fallback, shared throttle. The SDK is mocked."""

import json
from types import SimpleNamespace
from unittest import mock

import anthropic
import httpx2
from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase

from apps.common import ai

from .models import Course
from .traits import keyword_traits

URL = "/api/planner/courses/suggest-traits/"
REQUEST = httpx2.Request("POST", "https://api.example.invalid/v1/messages")


def message(data=None, *, text=None, stop_reason="end_turn"):
    return SimpleNamespace(
        stop_reason=stop_reason,
        content=[SimpleNamespace(type="text", text=text if text is not None else json.dumps(data))],
        model="claude-haiku-5-5",
        usage=SimpleNamespace(input_tokens=200, output_tokens=40),
    )


class KeywordTraitTests(SimpleTestCase):
    def demands(self, name):
        return keyword_traits(name)["learning_demands"]

    def test_documented_map(self):
        self.assertEqual(self.demands("MTH 201 Calculus II"), ["problem_solving"])
        self.assertTrue(keyword_traits("Linear Algebra")["builds_on_earlier"])
        self.assertEqual(self.demands("Modern European History"), ["writing", "conceptual"])
        self.assertEqual(self.demands("Philosophy of Mind"), ["writing", "conceptual"])
        self.assertEqual(self.demands("Human Anatomy"), ["memorisation"])
        self.assertEqual(self.demands("Contract Law"), ["memorisation"])
        self.assertEqual(self.demands("Chemistry Lab"), ["practical"])
        self.assertEqual(self.demands("Final Year Project"), ["practical"])

    def test_combinations_keep_rule_order_and_cap_at_three(self):
        self.assertEqual(self.demands("Physics Lab"), ["problem_solving", "practical"])
        self.assertEqual(
            self.demands("History of Mathematics and Law Studio"),
            ["problem_solving", "writing", "conceptual"],
        )

    def test_matches_word_starts_only(self):
        self.assertEqual(self.demands("Syllabus Review"), [])  # "lab" inside a word
        self.assertEqual(self.demands("Prehistoric Art"), [])  # "histor" inside a word

    def test_no_match(self):
        self.assertEqual(
            keyword_traits("Underwater Basket Weaving"),
            {"source": "keywords", "learning_demands": [], "builds_on_earlier": None, "assessment_format": None},
        )


class SuggestTraitsApiTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = User.objects.create_user(username="learner", password="TestPass123!")
        self.client.force_authenticate(self.user)

    def fake_client(self, *responses, side_effect=None):
        client = mock.MagicMock()
        client.messages.create.side_effect = side_effect if side_effect is not None else list(responses)
        patcher = mock.patch.object(ai, "get_client", return_value=client)
        patcher.start()
        self.addCleanup(patcher.stop)
        return client

    def suggest(self, name="Calculus"):
        response = self.client.post(URL, {"name": name}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    @override_settings(AI_PLAN_ENABLED=False)
    def test_keywords_without_a_key(self):
        client = self.fake_client()
        data = self.suggest("MTH 201 Calculus")
        self.assertEqual(data["source"], "keywords")
        self.assertEqual(data["learning_demands"], ["problem_solving"])
        self.assertFalse(data["throttled"])
        client.messages.create.assert_not_called()

    @override_settings(AI_PLAN_ENABLED=True)
    def test_ai_suggestion(self):
        client = self.fake_client(message({
            "learning_demands": ["problem_solving", "conceptual"],
            "builds_on_earlier": True,
            "assessment_format": "timed_problem_exam",
        }))
        data = self.suggest("Thermodynamics")
        self.assertEqual(data, {
            "source": "ai",
            "learning_demands": ["problem_solving", "conceptual"],
            "builds_on_earlier": True,
            "assessment_format": "timed_problem_exam",
            "throttled": False,
        })
        kwargs = client.messages.create.call_args.kwargs
        schema = kwargs["output_config"]["format"]["schema"]
        self.assertEqual(
            set(schema["properties"]["learning_demands"]["items"]["enum"]),
            {"problem_solving", "conceptual", "memorisation", "writing", "practical"},
        )
        self.assertIn("unknown", schema["properties"]["assessment_format"]["enum"])
        self.assertEqual(kwargs["messages"][0]["content"], '<course_name>"Thermodynamics"</course_name>')

    @override_settings(AI_PLAN_ENABLED=True)
    def test_unknown_format_becomes_null(self):
        self.fake_client(message({"learning_demands": ["writing"], "builds_on_earlier": False, "assessment_format": "unknown"}))
        self.assertIsNone(self.suggest("Creative Writing")["assessment_format"])

    @override_settings(AI_PLAN_ENABLED=True)
    def test_invalid_answers_and_failures_fall_back_to_keywords(self):
        cases = {
            "not an allowed demand": message({"learning_demands": ["vibes"], "builds_on_earlier": True, "assessment_format": "coursework"}),
            "too many demands": message({
                "learning_demands": ["writing", "conceptual", "practical", "memorisation"],
                "builds_on_earlier": False, "assessment_format": "coursework",
            }),
            "no demands": message({"learning_demands": [], "builds_on_earlier": False, "assessment_format": "coursework"}),
            "duplicate demands": message({"learning_demands": ["writing", "writing"], "builds_on_earlier": False, "assessment_format": "coursework"}),
            "bad format": message({"learning_demands": ["writing"], "builds_on_earlier": False, "assessment_format": "oral"}),
            "malformed": message(text="{nope"),
            "refusal": message({}, stop_reason="refusal"),
        }
        for label, response in cases.items():
            with self.subTest(label):
                cache.clear()
                self.fake_client(response)
                with self.assertLogs("apps.common.ai", "WARNING"):
                    data = self.suggest("Calculus")
                self.assertEqual(data["source"], "keywords")
                self.assertEqual(data["learning_demands"], ["problem_solving"])
        cache.clear()
        self.fake_client(side_effect=anthropic.APITimeoutError(request=REQUEST))
        with self.assertLogs("apps.common.ai", "WARNING"):
            self.assertEqual(self.suggest()["source"], "keywords")

    @override_settings(AI_PLAN_ENABLED=True, AI_PLAN_DAILY_LIMIT=1)
    def test_shares_the_daily_budget(self):
        client = self.fake_client(message({"learning_demands": ["writing"], "builds_on_earlier": False, "assessment_format": "essay_exam"}))
        self.assertEqual(self.suggest("History")["source"], "ai")
        limited = self.suggest("History")
        self.assertEqual(limited["source"], "keywords")
        self.assertTrue(limited["throttled"])
        self.assertEqual(client.messages.create.call_count, 1)

    def test_validation_and_nothing_saved(self):
        self.assertEqual(self.client.post(URL, {}, format="json").status_code, 400)
        self.assertEqual(self.client.post(URL, {"name": ""}, format="json").status_code, 400)
        self.assertEqual(self.client.post(URL, {"name": "x" * 121}, format="json").status_code, 400)
        self.suggest("Calculus")
        self.assertFalse(Course.objects.exists())

    def test_requires_authentication(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post(URL, {"name": "Calculus"}, format="json").status_code, 401)
