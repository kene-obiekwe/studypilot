from rest_framework import serializers

from apps.common.fields import FiniteFloatField

from .models import MAX_LEARNING_DEMANDS, AssessmentFormat, Course, LearningDemand

MAX_COURSES = 20
MAX_WEEKLY_HOURS = 168


class CourseInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    difficulty = serializers.IntegerField(min_value=1, max_value=5)


def validate_unique_courses(courses):
    seen: dict[str, str] = {}
    for course in courses:
        key = course["name"].strip().casefold()
        if key in seen:
            raise serializers.ValidationError(
                f'Duplicate course name: "{course["name"]}" (already listed as "{seen[key]}").'
            )
        seen[key] = course["name"]
    return courses


class PlanRequestSerializer(serializers.Serializer):
    """The first-version /generate/ request: a weekly total for this week's plan."""

    total_available_hours = FiniteFloatField(min_value=1, max_value=MAX_WEEKLY_HOURS)
    courses = CourseInputSerializer(many=True, allow_empty=False, min_length=1, max_length=MAX_COURSES)

    def validate_courses(self, courses):
        return validate_unique_courses(courses)


class WeeklyPlanRequestSerializer(serializers.Serializer):
    """A week's first plan (total_hours) or an update (more_hours), for preview or save.

    base_revision is the revision the client is updating: null (or absent) for a first plan.
    """

    courses = CourseInputSerializer(many=True, allow_empty=False, min_length=1, max_length=MAX_COURSES)
    total_hours = FiniteFloatField(min_value=1, max_value=MAX_WEEKLY_HOURS, required=False)
    more_hours = FiniteFloatField(min_value=0, max_value=MAX_WEEKLY_HOURS, required=False)
    base_revision = serializers.IntegerField(min_value=1, allow_null=True, required=False, default=None)

    def validate_courses(self, courses):
        return validate_unique_courses(courses)

    def validate(self, attrs):
        has_total, has_more = "total_hours" in attrs, "more_hours" in attrs
        if has_total == has_more:
            raise serializers.ValidationError("Give total_hours for a first plan or more_hours for an update, not both.")
        if has_total and attrs.get("base_revision") is not None:
            raise serializers.ValidationError({"total_hours": ["Use more_hours to update this week's plan."]})
        if has_more and attrs.get("base_revision") is None:
            raise serializers.ValidationError({"more_hours": ["A first plan takes total_hours."]})
        return attrs


class WeeklyPlanPreviewSerializer(WeeklyPlanRequestSerializer):
    week_start = serializers.DateField()


class CourseSerializer(serializers.ModelSerializer):
    """Request and response shape for /api/planner/courses/. Needs the request in its context."""

    name = serializers.CharField(max_length=120)
    difficulty = serializers.IntegerField(min_value=1, max_value=5, default=3)
    learning_demands = serializers.ListField(
        child=serializers.ChoiceField(choices=LearningDemand.choices),
        max_length=MAX_LEARNING_DEMANDS,
        required=False,
    )
    builds_on_earlier = serializers.BooleanField(allow_null=True, required=False)
    assessment_format = serializers.ChoiceField(choices=AssessmentFormat.choices, allow_blank=True, required=False)
    exam_date = serializers.DateField(allow_null=True, required=False)

    class Meta:
        model = Course
        fields = [
            "id",
            "name",
            "difficulty",
            "learning_demands",
            "builds_on_earlier",
            "assessment_format",
            "exam_date",
            "weekly_target_hours",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "weekly_target_hours", "created_at", "updated_at"]

    def validate_name(self, value: str) -> str:
        user = self.context["request"].user
        clash = Course.objects.filter(user=user, name__iexact=value)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        existing = clash.order_by("id").first()
        if existing is not None:
            raise serializers.ValidationError(f'You already have a course named "{existing.name}".')
        return value

    def validate_learning_demands(self, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise serializers.ValidationError("Each learning demand can only be chosen once.")
        return value


class PlanResponseSerializer(serializers.Serializer):
    allocations = serializers.ListField(child=serializers.DictField())


class StudyPlanHistorySerializer(serializers.Serializer):
    """The first-version /history/ item."""

    id = serializers.IntegerField()
    week_start = serializers.DateField()
    plan_json = serializers.JSONField()
    created_at = serializers.DateTimeField()


class WeeklyPlanSerializer(serializers.Serializer):
    """One revision of a week's plan. revision_count comes from the context (by week_start)."""

    id = serializers.IntegerField()
    week_start = serializers.DateField()
    revision = serializers.IntegerField()
    revision_count = serializers.SerializerMethodField()
    is_current = serializers.BooleanField()
    superseded_at = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    plan_json = serializers.JSONField()

    def get_revision_count(self, plan) -> int:
        return self.context.get("revision_counts", {}).get(plan.week_start, plan.revision)


class TraitSuggestionRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
