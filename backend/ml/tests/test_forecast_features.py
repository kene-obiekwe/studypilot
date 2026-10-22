"""Leakage and span checks for the OULAD next-week forecast panel.

Run from backend/: python -m unittest discover -s ml/tests
"""

import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import build_oulad_canonical as boc  # noqa: E402


NAN = float("nan")
GAP_WEEKS_S1 = (2, 5)
# Every column built from prior weeks: model features plus reporting-only columns.
LAG_COLUMNS = boc.FEATURE_COLUMNS + boc.REPORTING_COLUMNS


def make_courses() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "code_module": ["M1", "M1", "M1"],
            "code_presentation": ["2013J", "2014B", "2014J"],
            "module_presentation_length": [70, 70, 70],
        }
    )


def make_registrations() -> pd.DataFrame:
    rows = [
        # id_student, presentation, date_registration, date_unregistration
        (1, "2013J", -10, NAN),
        (2, "2013J", -10, 30),  # end_day 30 -> weeks 0..3
        (3, "2013J", -10, -5),  # unregistered before day 0 -> excluded
        (6, "2013J", -10, 3),  # no full week -> excluded
        (7, "2013J", -10, NAN),  # enrolled, never clicks
        (8, "2013J", 5, 35),  # late registration, never clicks, weeks 0..4
        (4, "2014B", -10, NAN),
        (1, "2014J", -10, NAN),  # same student, different presentation
        (5, "2014J", -10, NAN),
    ]
    df = pd.DataFrame(rows, columns=["id_student", "code_presentation", "date_registration", "date_unregistration"])
    df.insert(1, "code_module", "M1")
    return df


def make_vle(seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []

    def add_days(student, presentation, days):
        for day in days:
            for _ in range(int(rng.integers(1, 4))):
                rows.append(("M1", presentation, student, 1000, day, int(rng.integers(1, 20))))

    def random_days(start, stop, skip_weeks=()):
        days = [d for d in range(start, stop) if d // 7 not in skip_weeks and rng.random() < 0.6]
        # Guarantee at least one active day in every non-skipped week.
        forced = [7 * w + 1 for w in range(start // 7, (stop - 1) // 7 + 1) if w not in skip_weeks]
        return sorted(set(days) | {d for d in forced if start <= d < stop})

    add_days(1, "2013J", [-3, -1])  # before the presentation starts: ignored
    add_days(1, "2013J", random_days(0, 70, GAP_WEEKS_S1))
    add_days(1, "2013J", [70, 71])  # after module length: dropped
    add_days(2, "2013J", random_days(0, 46))  # days >= 28 fall after the enrolled span
    add_days(3, "2013J", random_days(0, 20))  # excluded registration
    add_days(4, "2014B", random_days(0, 70))
    add_days(1, "2014J", random_days(0, 70))
    add_days(5, "2014J", random_days(0, 70))

    vle = pd.DataFrame(
        rows, columns=["code_module", "code_presentation", "id_student", "id_site", "date", "sum_click"]
    )
    return vle.sort_values(["code_presentation", "id_student", "date"], kind="stable").reset_index(drop=True)


def split_chunks(vle: pd.DataFrame, n: int = 3):
    bounds = np.linspace(0, len(vle), n + 1, dtype=int)
    return [vle.iloc[a:b].copy() for a, b in zip(bounds[:-1], bounds[1:])]


def build(vle: pd.DataFrame, p90=None):
    """Run the pipeline step by step; optionally pin P90 so perturbations can't move it."""
    grid, _ = boc.build_enrolled_weeks(make_registrations(), make_courses())
    weekly, _ = boc.aggregate_weekly_activity(split_chunks(vle))
    panel, stats = boc.assemble_panel(grid, weekly)
    panel = boc.add_target(panel)
    computed_p90 = boc.compute_focus_p90(panel)
    panel = boc.add_features(panel, computed_p90 if p90 is None else p90)
    panel = boc.assign_split(panel)
    return panel.set_index(boc.KEY + ["week"]).sort_index(), computed_p90, stats


def row(panel, student, presentation, week):
    return panel.loc[(student, "M1", presentation, week)]


class SpanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vle = make_vle()
        cls.panel, cls.p90, cls.stats = build(cls.vle)

    def weeks_of(self, student, presentation):
        idx = self.panel.index
        mask = (idx.get_level_values("id_student") == student) & (
            idx.get_level_values("code_presentation") == presentation
        )
        return list(idx[mask].get_level_values("week"))

    def test_enrolled_span(self):
        self.assertEqual(self.weeks_of(1, "2013J"), list(range(10)))
        self.assertEqual(self.weeks_of(2, "2013J"), [0, 1, 2, 3])
        self.assertEqual(self.weeks_of(8, "2013J"), [0, 1, 2, 3, 4])
        self.assertEqual(self.weeks_of(3, "2013J"), [])
        self.assertEqual(self.weeks_of(6, "2013J"), [])
        self.assertGreater(self.stats["activity_weeks_dropped_after_enrolled_span"], 0)
        self.assertGreater(self.stats["activity_weeks_dropped_registration_excluded_or_missing"], 0)

    def test_negative_dates_ignored_and_active_days_are_distinct_days(self):
        vle = self.vle[(self.vle["date"] >= 0)]
        for (student, presentation), group in vle.groupby(["id_student", "code_presentation"]):
            for week in self.weeks_of(student, presentation):
                in_week = group[group["date"] // 7 == week]
                r = row(self.panel, student, presentation, week)
                self.assertEqual(r["total_clicks"], in_week["sum_click"].sum())
                self.assertEqual(r["active_days"], in_week["date"].nunique())

    def test_gap_filled_weeks_are_zero_activity(self):
        for week in GAP_WEEKS_S1:
            r = row(self.panel, 1, "2013J", week)
            self.assertTrue(r["gap_filled"])
            self.assertEqual(r["total_clicks"], 0)
            self.assertEqual(r["active_days"], 0)
            nxt = row(self.panel, 1, "2013J", week + 1)
            self.assertEqual(nxt["active_days_lag1"], 0)
            self.assertEqual(nxt["focus_lag1"], 0)
        never_clicks = self.panel.xs((7, "M1", "2013J"), level=boc.KEY)
        self.assertTrue(never_clicks["gap_filled"].all())
        self.assertTrue((never_clicks["total_clicks"] == 0).all())

    def test_zero_expected_clicks_is_missing_not_zero(self):
        # Week 5 of 2013J: student 1 has a gap and students 7 and 8 never click, so the median is 0.
        r5 = row(self.panel, 1, "2013J", 5)
        self.assertEqual(r5["expected_clicks"], 0)
        self.assertTrue(np.isnan(r5[boc.TARGET_COLUMN]))
        self.assertFalse(r5["is_training_row"])
        r6 = row(self.panel, 1, "2013J", 6)
        self.assertTrue(np.isnan(r6["adh_lag1"]))
        self.assertTrue(np.isnan(r6["adh_trend"]))
        expected_mean = np.nanmean(
            [row(self.panel, 1, "2013J", w)[boc.TARGET_COLUMN] for w in (3, 4, 5)]
        )
        self.assertAlmostEqual(r6["adh_mean3"], expected_mean)


class FeatureListTests(unittest.TestCase):
    def test_model_features_are_app_comparable_only(self):
        self.assertEqual(boc.FEATURE_COLUMNS, ["adh_lag1", "adh_lag2", "adh_mean3", "adh_trend", "weeks_history"])
        self.assertFalse(set(boc.FEATURE_COLUMNS) & set(boc.REPORTING_COLUMNS))


class LeakageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vle = make_vle()
        cls.panel, cls.p90, _ = build(cls.vle)

    def test_features_match_reference_from_prior_weeks(self):
        for key, reg in self.panel.groupby(level=boc.KEY):
            reg = reg.droplevel(boc.KEY)
            for t in reg.index:
                prior = reg.loc[reg.index < t]
                r = reg.loc[t]
                self.assertEqual(r["weeks_history"], len(prior))
                if t == 0:
                    for col in [c for c in LAG_COLUMNS if c != "weeks_history"]:
                        self.assertTrue(np.isnan(r[col]), (key, t, col))
                    continue
                last3 = prior.tail(3)
                adh, days = prior[boc.TARGET_COLUMN], prior["active_days"]
                expected = {
                    "adh_lag1": adh.iloc[-1],
                    "adh_lag2": adh.iloc[-2] if len(prior) >= 2 else NAN,
                    "adh_mean3": last3[boc.TARGET_COLUMN].mean(),
                    "adh_trend": adh.iloc[-1] - adh.iloc[-2] if len(prior) >= 2 else NAN,
                    "active_days_lag1": days.iloc[-1],
                    "active_days_mean3": last3["active_days"].mean(),
                    "focus_lag1": min(
                        prior["total_clicks"].iloc[-1] / max(days.iloc[-1], 1) / self.p90, 1.0
                    ),
                }
                for col, value in expected.items():
                    if pd.isna(value):
                        self.assertTrue(pd.isna(r[col]), (key, t, col))
                    else:
                        self.assertAlmostEqual(r[col], value, places=12, msg=(key, t, col))

    def test_changing_week_t_onwards_never_changes_features_at_week_t(self):
        rng = np.random.default_rng(1)
        for t in range(1, 10):
            vle = self.vle.copy()
            future = vle["date"] >= 7 * t
            vle.loc[future, "sum_click"] = rng.integers(1, 500, size=int(future.sum()))
            extra = pd.DataFrame(
                {
                    "code_module": "M1",
                    "code_presentation": ["2013J", "2014B", "2014J"],
                    "id_student": [1, 4, 5],
                    "id_site": 1000,
                    "date": [7 * t + 3] * 3,
                    "sum_click": [999, 999, 999],
                }
            )
            vle = pd.concat([vle, extra], ignore_index=True)
            # Also turn student 2's week t into a gap.
            vle = vle[~((vle["id_student"] == 2) & (vle["date"] // 7 == t))]
            perturbed, _, _ = build(vle, p90=self.p90)
            weeks = self.panel.index.get_level_values("week")
            upto_t = self.panel.loc[weeks <= t, LAG_COLUMNS]
            pd.testing.assert_frame_equal(
                perturbed.loc[upto_t.index, LAG_COLUMNS], upto_t, obj=f"features up to week {t}"
            )


class SplitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vle = make_vle()
        cls.panel, cls.p90, _ = build(cls.vle)

    def test_test_presentation_only_in_test_split(self):
        presentation = self.panel.index.get_level_values("code_presentation")
        self.assertTrue((self.panel.loc[presentation == "2014J", "split"] == "test").all())
        self.assertTrue((self.panel.loc[presentation != "2014J", "split"] != "test").all())
        self.assertEqual(set(self.panel.loc[presentation == "2014B", "split"]), {"validation"})
        self.assertEqual(set(self.panel.loc[presentation == "2013J", "split"]), {"train"})

        regs = self.panel.reset_index()[boc.KEY + ["split"]].drop_duplicates()
        test_keys = set(map(tuple, regs.loc[regs["split"] == "test", boc.KEY].to_numpy()))
        other_keys = set(map(tuple, regs.loc[regs["split"] != "test", boc.KEY].to_numpy()))
        self.assertTrue(test_keys)
        self.assertFalse(test_keys & other_keys)

    def test_test_data_does_not_influence_train_or_validation(self):
        vle = self.vle.copy()
        in_test = vle["code_presentation"] == "2014J"
        vle.loc[in_test, "sum_click"] *= 37
        perturbed, p90, _ = build(vle)
        self.assertEqual(p90, self.p90)
        not_test = self.panel["split"] != "test"
        pd.testing.assert_frame_equal(perturbed.loc[not_test], self.panel.loc[not_test])

    def test_train_data_does_not_influence_test_targets(self):
        vle = self.vle.copy()
        vle.loc[vle["code_presentation"] == "2013J", "sum_click"] *= 11
        perturbed, _, _ = build(vle, p90=self.p90)
        is_test = self.panel["split"] == "test"
        cols = ["total_clicks", "active_days", "expected_clicks", boc.TARGET_COLUMN, *LAG_COLUMNS]
        pd.testing.assert_frame_equal(perturbed.loc[is_test, cols], self.panel.loc[is_test, cols])


if __name__ == "__main__":
    unittest.main()
