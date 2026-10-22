from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import RecommendationLog
from .services import get_recommendations

SHORT_SESSIONS = "Use shorter 30-minute sessions with 10-minute breaks."
PRIORITY_TOPIC = "Start each day with one priority topic before other tasks."
DISTRACTION_FREE = "Enable distraction-free mode and schedule phone-free study blocks."
VISUAL = "Use diagrams and mind maps for revision."
READING = "Use structured summary notes and spaced repetition flashcards."
PRACTICE = "Use problem-based practice and timed quizzes."
MIXED = "Combine short videos, notes, and practice questions for each topic."


class RecommendationRuleTests(APITestCase):
    """Rule branches, exercised through the service directly."""

    def test_low_completion_adds_session_and_priority_advice(self):
        strategies, _ = get_recommendations(0.9, 0.49, "visual")
        self.assertIn(SHORT_SESSIONS, strategies)
        self.assertIn(PRIORITY_TOPIC, strategies)

    def test_completion_boundary_is_not_low(self):
        strategies, _ = get_recommendations(0.9, 0.5, "visual")
        self.assertNotIn(SHORT_SESSIONS, strategies)
        self.assertNotIn(PRIORITY_TOPIC, strategies)

    def test_low_focus_adds_distraction_free_advice(self):
        strategies, _ = get_recommendations(0.59, 0.9, "visual")
        self.assertIn(DISTRACTION_FREE, strategies)

    def test_focus_boundary_is_not_low(self):
        strategies, _ = get_recommendations(0.6, 0.9, "visual")
        self.assertNotIn(DISTRACTION_FREE, strategies)

    def test_each_preferred_style_adds_its_own_advice(self):
        expected = {"visual": VISUAL, "reading": READING, "practice": PRACTICE, "mixed": MIXED}
        for style, advice in expected.items():
            with self.subTest(style=style):
                strategies, _ = get_recommendations(0.9, 0.9, style)
                self.assertEqual(strategies, [advice])

    def test_unknown_style_falls_back_to_mixed_advice(self):
        strategies, _ = get_recommendations(0.9, 0.9, "something-else")
        self.assertEqual(strategies, [MIXED])

    def test_low_completion_and_low_focus_combine_in_order(self):
        strategies, _ = get_recommendations(0.2, 0.2, "practice")
        self.assertEqual(strategies, [SHORT_SESSIONS, PRIORITY_TOPIC, DISTRACTION_FREE, PRACTICE])

    def test_confidence_is_zero_at_the_midpoint(self):
        _, confidence = get_recommendations(0.5, 0.5, "mixed")
        self.assertEqual(confidence, 0.0)

    def test_confidence_scales_with_distance_from_midpoint(self):
        _, confidence = get_recommendations(0.75, 0.5, "mixed")
        self.assertAlmostEqual(confidence, 0.5)

    def test_confidence_is_capped_at_one(self):
        _, confidence = get_recommendations(1.0, 1.0, "mixed")
        self.assertEqual(confidence, 1.0)

    def test_confidence_stays_within_unit_interval(self):
        steps = [i / 10 for i in range(11)]
        for focus in steps:
            for completion in steps:
                with self.subTest(focus=focus, completion=completion):
                    _, confidence = get_recommendations(focus, completion, "mixed")
                    self.assertGreaterEqual(confidence, 0.0)
                    self.assertLessEqual(confidence, 1.0)


class RecommendationApiTests(APITestCase):
    generate_url = "/api/recommendations/generate/"
    history_url = "/api/recommendations/history/"

    def setUp(self):
        self.user = User.objects.create_user(username="recuser", password="TestPass123!")
        self.client.force_authenticate(user=self.user)

    def generate(self, **overrides):
        data = {"focus_score": 0.4, "completion_rate": 0.3, "preferred_style": "visual"}
        data.update(overrides)
        return self.client.post(self.generate_url, data, format="json")

    def test_generate_returns_strategies_and_confidence(self):
        response = self.generate()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["strategies"], [SHORT_SESSIONS, PRIORITY_TOPIC, DISTRACTION_FREE, VISUAL])
        self.assertAlmostEqual(response.data["confidence"], 0.6)

    def test_generate_creates_log_for_caller(self):
        self.generate(preferred_style="reading")
        log = RecommendationLog.objects.get()
        self.assertEqual(log.user, self.user)
        self.assertEqual(log.focus_score, 0.4)
        self.assertEqual(log.completion_rate, 0.3)
        self.assertEqual(log.preferred_style, "reading")
        self.assertIn(READING, log.strategies_json)
        self.assertAlmostEqual(log.confidence, 0.6)

    def test_every_response_confidence_is_within_unit_interval(self):
        for focus, completion in [(0, 0), (0, 1), (1, 0), (1, 1), (0.5, 0.5), (0.6, 0.49)]:
            with self.subTest(focus=focus, completion=completion):
                response = self.generate(focus_score=focus, completion_rate=completion)
                self.assertEqual(response.status_code, 200)
                self.assertGreaterEqual(response.data["confidence"], 0.0)
                self.assertLessEqual(response.data["confidence"], 1.0)

    def test_invalid_style_returns_400_and_logs_nothing(self):
        response = self.generate(preferred_style="auditory")
        self.assertEqual(response.status_code, 400)
        self.assertIn("preferred_style", response.data)
        self.assertEqual(RecommendationLog.objects.count(), 0)

    def test_out_of_range_scores_return_400(self):
        for field in ("focus_score", "completion_rate"):
            for value in (-0.1, 1.1):
                with self.subTest(field=field, value=value):
                    response = self.generate(**{field: value})
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.data)
        self.assertEqual(RecommendationLog.objects.count(), 0)

    def test_missing_fields_return_400(self):
        response = self.client.post(self.generate_url, {}, format="json")
        self.assertEqual(response.status_code, 400)
        for field in ("focus_score", "completion_rate", "preferred_style"):
            self.assertIn(field, response.data)

    def test_history_is_empty_without_logs(self):
        response = self.client.get(self.history_url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {"items": []})

    def test_history_returns_only_callers_logs(self):
        other = User.objects.create_user(username="otherrec", password="TestPass123!")
        RecommendationLog.objects.create(
            user=other, focus_score=0.1, completion_rate=0.1, preferred_style="practice", strategies_json=["x"]
        )
        self.generate()
        response = self.client.get(self.history_url)
        self.assertEqual(len(response.data["items"]), 1)
        self.assertEqual(response.data["items"][0]["preferred_style"], "visual")

    def test_history_is_newest_first(self):
        now = timezone.now()
        for age_days, style in [(3, "visual"), (1, "reading"), (2, "practice")]:
            log = RecommendationLog.objects.create(
                user=self.user, focus_score=0.5, completion_rate=0.5, preferred_style=style
            )
            RecommendationLog.objects.filter(pk=log.pk).update(created_at=now - timedelta(days=age_days))
        response = self.client.get(self.history_url)
        self.assertEqual([item["preferred_style"] for item in response.data["items"]], ["reading", "practice", "visual"])

    def test_history_item_shape(self):
        self.generate()
        item = self.client.get(self.history_url).data["items"][0]
        for key in ("id", "focus_score", "completion_rate", "preferred_style", "strategies_json", "confidence", "created_at"):
            self.assertIn(key, item)
