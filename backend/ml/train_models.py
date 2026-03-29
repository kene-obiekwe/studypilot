from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder


def build_features(data: pd.DataFrame) -> pd.DataFrame:
    data = data.copy()
    data["adherence_score"] = np.clip(data["actual_minutes"] / data["planned_minutes"].clip(lower=1), 0, 1)
    return data


def train_regression(df: pd.DataFrame, output_dir: Path) -> dict:
    feature_cols = [
        "difficulty",
        "planned_minutes",
        "focus_score",
        "completion_rate",
        "sessions_last_7_days",
        "deadlines_within_7_days",
        "preferred_style",
    ]
    X = df[feature_cols]
    y = df["adherence_score"]

    num_cols = [
        "difficulty",
        "planned_minutes",
        "focus_score",
        "completion_rate",
        "sessions_last_7_days",
        "deadlines_within_7_days",
    ]
    cat_cols = ["preferred_style"]

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", Pipeline([("imputer", SimpleImputer(strategy="median"))]), num_cols),
            (
                "cat",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("encoder", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                cat_cols,
            ),
        ]
    )

    model = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("regressor", RandomForestRegressor(n_estimators=200, random_state=42)),
        ]
    )

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    model.fit(X_train, y_train)
    preds = model.predict(X_test)

    metrics = {
        "mae": float(mean_absolute_error(y_test, preds)),
        "rmse": float(np.sqrt(mean_squared_error(y_test, preds))),
        "r2": float(r2_score(y_test, preds)),
    }

    joblib.dump(model, output_dir / "adherence_model.joblib")
    return metrics


def train_classification(df: pd.DataFrame, output_dir: Path) -> dict:
    if "strategy_label" not in df.columns:
        return {"error": "strategy_label not found; classification skipped."}

    feature_cols = [
        "difficulty",
        "planned_minutes",
        "focus_score",
        "completion_rate",
        "sessions_last_7_days",
        "deadlines_within_7_days",
        "preferred_style",
    ]
    X = df[feature_cols]
    y = df["strategy_label"]

    num_cols = [
        "difficulty",
        "planned_minutes",
        "focus_score",
        "completion_rate",
        "sessions_last_7_days",
        "deadlines_within_7_days",
    ]
    cat_cols = ["preferred_style"]

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", Pipeline([("imputer", SimpleImputer(strategy="median"))]), num_cols),
            (
                "cat",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("encoder", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                cat_cols,
            ),
        ]
    )

    model = Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            ("classifier", RandomForestClassifier(n_estimators=300, random_state=42)),
        ]
    )

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    model.fit(X_train, y_train)
    preds = model.predict(X_test)

    metrics = {
        "accuracy": float(accuracy_score(y_test, preds)),
        "precision_macro": float(precision_score(y_test, preds, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y_test, preds, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(y_test, preds, average="macro", zero_division=0)),
    }

    joblib.dump(model, output_dir / "strategy_model.joblib")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Train FYP AI models")
    parser.add_argument("--data", required=True, help="Path to training CSV")
    parser.add_argument("--output", default="ml/models", help="Output directory for model artifacts")
    args = parser.parse_args()

    data_path = Path(args.data)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(data_path)
    df = build_features(df)

    reg_metrics = train_regression(df, output_dir)
    clf_metrics = train_classification(df, output_dir)

    report = {
        "regression": reg_metrics,
        "classification": clf_metrics,
    }
    report_path = output_dir / "training_report.json"
    pd.Series(report).to_json(report_path, indent=2)

    print("Training complete")
    print(report)


if __name__ == "__main__":
    main()
