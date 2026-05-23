import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestRegressor


FEATURE_COLUMNS = [
    "planned_minutes",
    "actual_minutes",
    "completion_rate",
    "sessions_last_7_days",
    "focus_score",
    "help_seeking_rate",
    "consistency_score",
    "avg_quiz_score_recent",
    "created_at",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train adherence model on OULAD canonical dataset.")
    parser.add_argument(
        "--data",
        default="backend/ml/data/oulad/training_dataset.csv",
        help="Path to canonical OULAD training CSV.",
    )
    parser.add_argument(
        "--output-dir",
        default="backend/ml/models",
        help="Directory to write model artifacts.",
    )
    parser.add_argument(
        "--report-dir",
        default="backend/ml/reports",
        help="Directory to write training reports.",
    )
    parser.add_argument(
        "--test-size",
        type=float,
        default=0.2,
        help="Test split size (default: 0.2).",
    )
    parser.add_argument(
        "--val-size",
        type=float,
        default=0.1,
        help="Validation split size (default: 0.1).",
    )
    parser.add_argument(
        "--split",
        choices=["random", "time"],
        default="time",
        help="Split strategy: random or time-based (default: time).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200000,
        help="Optional row limit for faster runs (0 means all rows).",
    )
    parser.add_argument(
        "--n-estimators",
        type=int,
        default=200,
        help="Number of trees for RandomForestRegressor (default: 200).",
    )
    return parser.parse_args()


def build_splits(df: pd.DataFrame, test_size: float, val_size: float, split: str):
    if test_size <= 0 or val_size < 0:
        raise ValueError("test_size must be > 0 and val_size must be >= 0")
    if test_size + val_size >= 1:
        raise ValueError("test_size + val_size must be < 1")

    if split == "time":
        df = df.sort_values("created_at")
        n = len(df)
        n_train = int(n * (1 - test_size - val_size))
        n_val = int(n * val_size)
        train_df = df.iloc[:n_train]
        val_df = df.iloc[n_train : n_train + n_val]
        test_df = df.iloc[n_train + n_val :]
        return train_df, val_df, test_df

    train_val_df, test_df = train_test_split(df, test_size=test_size, random_state=42)
    relative_val = val_size / (1 - test_size)
    train_df, val_df = train_test_split(train_val_df, test_size=relative_val, random_state=42)
    return train_df, val_df, test_df


def data_quality_checks(df: pd.DataFrame) -> dict:
    checks = {
        "row_count": int(len(df)),
        "duplicate_rows": int(df.duplicated().sum()),
        "missing_rate": df[FEATURE_COLUMNS + ["adherence_score"]].isna().mean().round(4).to_dict(),
        "adherence_out_of_bounds": int(((df["adherence_score"] < 0) | (df["adherence_score"] > 1)).sum()),
        "completion_rate_out_of_bounds": int(((df["completion_rate"] < 0) | (df["completion_rate"] > 1)).sum()),
        "planned_minutes_non_positive": int((df["planned_minutes"] <= 0).sum()),
        "actual_minutes_negative": int((df["actual_minutes"] < 0).sum()),
    }
    return checks


def score_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "r2": float(r2_score(y_true, y_pred)),
    }


def save_plots(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    baseline_pred: np.ndarray,
    feature_importances: dict,
    output_dir: Path,
):
    output_dir.mkdir(parents=True, exist_ok=True)

    sample_size = min(len(y_true), 15000)
    if sample_size < len(y_true):
        idx = np.random.RandomState(42).choice(len(y_true), size=sample_size, replace=False)
        y_true = y_true[idx]
        y_pred = y_pred[idx]
        baseline_pred = baseline_pred[idx]

    plt.figure(figsize=(6, 5))
    plt.scatter(y_true, y_pred, alpha=0.25, s=8)
    plt.plot([0, 1], [0, 1], color="black", linestyle="--", linewidth=1)
    plt.xlabel("True adherence")
    plt.ylabel("Predicted adherence")
    plt.title("Predicted vs True (Sample)")
    scatter_path = output_dir / "predicted_vs_true.png"
    plt.tight_layout()
    plt.savefig(scatter_path, dpi=160)
    plt.close()

    residuals = y_true - y_pred
    plt.figure(figsize=(6, 4))
    plt.hist(residuals, bins=50, color="#4c78a8", alpha=0.85)
    plt.xlabel("Residual (true - predicted)")
    plt.ylabel("Count")
    plt.title("Residual Distribution")
    resid_path = output_dir / "residuals_hist.png"
    plt.tight_layout()
    plt.savefig(resid_path, dpi=160)
    plt.close()

    baseline_metrics = score_metrics(y_true, baseline_pred)
    model_metrics = score_metrics(y_true, y_pred)
    labels = ["MAE", "RMSE", "R2"]
    baseline_vals = [baseline_metrics["mae"], baseline_metrics["rmse"], baseline_metrics["r2"]]
    model_vals = [model_metrics["mae"], model_metrics["rmse"], model_metrics["r2"]]

    x = np.arange(len(labels))
    width = 0.35
    plt.figure(figsize=(6, 4))
    plt.bar(x - width / 2, baseline_vals, width, label="Baseline")
    plt.bar(x + width / 2, model_vals, width, label="Model")
    plt.xticks(x, labels)
    plt.title("Baseline vs Model Metrics")
    plt.legend()
    metrics_path = output_dir / "baseline_vs_model.png"
    plt.tight_layout()
    plt.savefig(metrics_path, dpi=160)
    plt.close()

    if feature_importances:
        names = list(feature_importances.keys())
        values = list(feature_importances.values())
        order = np.argsort(values)
        plt.figure(figsize=(7, 5))
        plt.barh([names[i] for i in order], [values[i] for i in order])
        plt.xlabel("Importance")
        plt.title("Feature Importance")
        feat_path = output_dir / "feature_importance.png"
        plt.tight_layout()
        plt.savefig(feat_path, dpi=160)
        plt.close()

    return {
        "predicted_vs_true": str(scatter_path),
        "residuals_hist": str(resid_path),
        "baseline_vs_model": str(metrics_path),
        "feature_importance": str(output_dir / "feature_importance.png"),
    }


def main() -> None:
    args = parse_args()
    data_path = Path(args.data)
    if not data_path.exists():
        raise SystemExit(f"Training data not found: {data_path}")

    df = pd.read_csv(data_path)
    if args.limit and args.limit > 0 and len(df) > args.limit:
        if args.split == "time":
            df = df.sort_values("created_at").tail(args.limit)
        else:
            df = df.sample(n=args.limit, random_state=42)

    quality = data_quality_checks(df)

    train_df, val_df, test_df = build_splits(df, args.test_size, args.val_size, args.split)

    X_train = train_df[FEATURE_COLUMNS]
    y_train = train_df["adherence_score"]
    X_val = val_df[FEATURE_COLUMNS]
    y_val = val_df["adherence_score"]
    X_test = test_df[FEATURE_COLUMNS]
    y_test = test_df["adherence_score"]

    baseline_pred = np.full_like(y_test, y_train.mean(), dtype=float)
    baseline_metrics = score_metrics(y_test, baseline_pred)

    param_grid = [
        {"n_estimators": args.n_estimators, "max_depth": None, "min_samples_leaf": 1},
        {"n_estimators": args.n_estimators, "max_depth": 12, "min_samples_leaf": 2},
        {"n_estimators": args.n_estimators, "max_depth": 20, "min_samples_leaf": 5},
    ]

    best = {"rmse": float("inf"), "params": None, "model": None}
    for params in param_grid:
        model = Pipeline(
            steps=[
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "regressor",
                    RandomForestRegressor(
                        n_estimators=params["n_estimators"],
                        max_depth=params["max_depth"],
                        min_samples_leaf=params["min_samples_leaf"],
                        random_state=42,
                        n_jobs=-1,
                    ),
                ),
            ]
        )
        model.fit(X_train, y_train)
        val_pred = model.predict(X_val)
        rmse = float(np.sqrt(mean_squared_error(y_val, val_pred)))
        if rmse < best["rmse"]:
            best = {"rmse": rmse, "params": params, "model": model}

    best_params = best["params"]
    final_model = best["model"]

    # Refit on train + val for final evaluation
    X_train_full = pd.concat([X_train, X_val], axis=0)
    y_train_full = pd.concat([y_train, y_val], axis=0)
    final_model.fit(X_train_full, y_train_full)

    preds = final_model.predict(X_test)
    model_metrics = score_metrics(y_test, preds)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / "oulad_adherence_model.joblib"
    joblib.dump(final_model, model_path)

    report_dir = Path(args.report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "oulad_training_report.json"

    plot_dir = report_dir / "oulad_plots"
    feature_importances = {}
    regressor = final_model.named_steps.get("regressor")
    if hasattr(regressor, "feature_importances_"):
        feature_importances = {
            name: float(val)
            for name, val in zip(FEATURE_COLUMNS, regressor.feature_importances_)
        }
    plot_paths = save_plots(
        y_test.to_numpy(),
        preds,
        baseline_pred,
        feature_importances,
        plot_dir,
    )

    report = {
        "data_path": str(data_path),
        "row_count": int(len(df)),
        "feature_columns": FEATURE_COLUMNS,
        "data_quality": quality,
        "feature_importance": feature_importances,
        "split": args.split,
        "val_size": args.val_size,
        "test_size": args.test_size,
        "limit": args.limit,
        "best_params": best_params,
        "baseline_metrics": baseline_metrics,
        "model_metrics": model_metrics,
        "model_path": str(model_path),
        "plots": plot_paths,
    }

    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print("Training complete")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
