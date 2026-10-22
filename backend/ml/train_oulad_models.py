"""Train the next-week adherence forecast on the OULAD weekly panel.

Reads forecast_panel.csv from build_oulad_canonical.py, selects a Random Forest
on validation RMSE among configs whose saved file fits the size cap, refits it on
train + validation, and evaluates once on the held-out test presentation against
mean, persistence and 3-week-mean baselines.
"""

import argparse
import json
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import sklearn  # noqa: E402
from sklearn.ensemble import RandomForestRegressor  # noqa: E402
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score  # noqa: E402
from sklearn.pipeline import Pipeline  # noqa: E402

from build_oulad_canonical import (  # noqa: E402
    FEATURE_COLUMNS,
    MIN_WEEKS_HISTORY,
    REPO_ROOT,
    TARGET_COLUMN,
    TEST_PRESENTATIONS,
    TRAIN_PRESENTATIONS,
    VAL_PRESENTATIONS,
)


MODEL_NAME = "oulad_adherence_forecast"
RANDOM_STATE = 42
N_ESTIMATORS = 100
MAX_DEPTHS = (8, 12, 16)
MIN_SAMPLES_LEAFS = (20, 50, 100)
COMPRESS = 3
HISTORY_BUCKETS = [("2-4", 2, 4), ("5-12", 5, 12), ("13+", 13, None)]


def parse_args() -> argparse.Namespace:
    ml_dir = REPO_ROOT / "backend" / "ml"
    parser = argparse.ArgumentParser(description="Train the OULAD next-week adherence forecast.")
    parser.add_argument(
        "--panel",
        default=str(ml_dir / "data" / "oulad" / "forecast_panel.csv"),
        help="Path to forecast_panel.csv.",
    )
    parser.add_argument(
        "--panel-metadata",
        default=str(ml_dir / "data" / "oulad" / "forecast_metadata.json"),
        help="Path to forecast_metadata.json (for P90 and span rules).",
    )
    parser.add_argument("--model-dir", default=str(ml_dir / "models"), help="Directory for the model artifact.")
    parser.add_argument("--report-dir", default=str(ml_dir / "reports"), help="Directory for the report and plots.")
    parser.add_argument(
        "--size-limit-mb",
        type=float,
        default=30.0,
        help="Only configs whose compressed file is under this size are eligible (default: 30).",
    )
    parser.add_argument(
        "--max-train-rows",
        type=int,
        default=0,
        help="Subsample training rows with a fixed seed if > 0 (default: 0, use all rows).",
    )
    return parser.parse_args()


def make_model(max_depth: int, min_samples_leaf: int) -> Pipeline:
    return Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "regressor",
                RandomForestRegressor(
                    n_estimators=N_ESTIMATORS,
                    max_depth=max_depth,
                    min_samples_leaf=min_samples_leaf,
                    random_state=RANDOM_STATE,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def score_metrics(y_true, y_pred) -> dict:
    return {
        "n": int(len(y_true)),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "r2": float(r2_score(y_true, y_pred)),
    }


def saved_size_mb(model: Pipeline) -> float:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "model.joblib"
        joblib.dump(model, path, compress=COMPRESS)
        return path.stat().st_size / 1e6


def load_training_rows(panel_path: Path) -> pd.DataFrame:
    columns = ["id_student", "code_module", "code_presentation", "week", "split", TARGET_COLUMN,
               *FEATURE_COLUMNS, "is_training_row"]
    panel = pd.read_csv(panel_path, usecols=columns)
    rows = panel.loc[panel["is_training_row"]].reset_index(drop=True)
    if rows[TARGET_COLUMN].isna().any() or (rows["weeks_history"] < MIN_WEEKS_HISTORY).any():
        raise ValueError("is_training_row includes rows without a target or with too little history.")
    expected = {
        "train": set(TRAIN_PRESENTATIONS),
        "validation": set(VAL_PRESENTATIONS),
        "test": set(TEST_PRESENTATIONS),
    }
    for split, presentations in expected.items():
        found = set(rows.loc[rows["split"] == split, "code_presentation"])
        if found != presentations:
            raise ValueError(f"Split {split} has presentations {sorted(found)}, expected {sorted(presentations)}.")
    return rows


def baseline_predictions(test: pd.DataFrame, train_mean: float) -> tuple[dict, dict]:
    """Mean, persistence and 3-week mean; missing lags fall back to the train+val mean."""
    persistence = test["adh_lag1"]
    mean3 = test["adh_mean3"]
    preds = {
        "mean": np.full(len(test), train_mean),
        "persistence": persistence.fillna(train_mean).to_numpy(),
        "mean3": mean3.fillna(train_mean).to_numpy(),
    }
    fallbacks = {
        "persistence_rows_filled_with_mean": int(persistence.isna().sum()),
        "mean3_rows_filled_with_mean": int(mean3.isna().sum()),
    }
    return preds, fallbacks


def evaluate(test: pd.DataFrame, preds: dict) -> dict:
    y = test[TARGET_COLUMN].to_numpy()
    result = {"overall": {name: score_metrics(y, p) for name, p in preds.items()}}

    result["by_module"] = {}
    for module, idx in test.groupby("code_module").indices.items():
        result["by_module"][module] = {name: score_metrics(y[idx], p[idx]) for name, p in preds.items()}

    result["by_weeks_history"] = {}
    history = test["weeks_history"].to_numpy()
    for label, low, high in HISTORY_BUCKETS:
        mask = history >= low if high is None else (history >= low) & (history <= high)
        result["by_weeks_history"][label] = {name: score_metrics(y[mask], p[mask]) for name, p in preds.items()}
    return result


def save_plots(test: pd.DataFrame, preds: dict, metrics: dict, importances: dict, plot_dir: Path) -> dict:
    plot_dir.mkdir(parents=True, exist_ok=True)
    y = test[TARGET_COLUMN].to_numpy()
    model_pred = preds["model"]
    paths = {}

    plt.figure(figsize=(6, 5))
    plt.hexbin(y, model_pred, gridsize=40, bins="log", cmap="viridis", extent=(0, 1, 0, 1))
    plt.colorbar(label="log10(count)")
    plt.plot([0, 1], [0, 1], color="white", linestyle="--", linewidth=1)
    plt.xlabel("True next-week adherence")
    plt.ylabel("Predicted next-week adherence")
    plt.title(f"Predicted vs true (test {', '.join(TEST_PRESENTATIONS)})")
    paths["predicted_vs_true"] = plot_dir / "predicted_vs_true.png"
    plt.tight_layout()
    plt.savefig(paths["predicted_vs_true"], dpi=160)
    plt.close()

    plt.figure(figsize=(6, 4))
    plt.hist(y - model_pred, bins=60, color="#4c78a8", alpha=0.85)
    plt.xlabel("Residual (true - predicted)")
    plt.ylabel("Count")
    plt.title("Residual distribution (test)")
    paths["residuals_hist"] = plot_dir / "residuals_hist.png"
    plt.tight_layout()
    plt.savefig(paths["residuals_hist"], dpi=160)
    plt.close()

    names = list(preds.keys())
    overall = metrics["overall"]
    x = np.arange(len(names))
    width = 0.38
    plt.figure(figsize=(7, 4))
    plt.bar(x - width / 2, [overall[n]["mae"] for n in names], width, label="MAE")
    plt.bar(x + width / 2, [overall[n]["rmse"] for n in names], width, label="RMSE")
    plt.xticks(x, names)
    plt.ylabel("Error (lower is better)")
    plt.title("Model vs baselines (test)")
    plt.legend()
    paths["model_vs_baselines"] = plot_dir / "model_vs_baselines.png"
    plt.tight_layout()
    plt.savefig(paths["model_vs_baselines"], dpi=160)
    plt.close()

    order = np.argsort(list(importances.values()))
    labels = list(importances.keys())
    values = list(importances.values())
    plt.figure(figsize=(7, 4.5))
    plt.barh([labels[i] for i in order], [values[i] for i in order])
    plt.xlabel("Impurity-based importance")
    plt.title("Feature importance")
    paths["feature_importance"] = plot_dir / "feature_importance.png"
    plt.tight_layout()
    plt.savefig(paths["feature_importance"], dpi=160)
    plt.close()

    return {name: str(path) for name, path in paths.items()}


def main() -> None:
    args = parse_args()
    started = time.perf_counter()
    panel_path = Path(args.panel)
    if not panel_path.exists():
        raise SystemExit(f"Panel not found: {panel_path}. Run build_oulad_canonical.py first.")
    panel_metadata = json.loads(Path(args.panel_metadata).read_text(encoding="utf-8"))

    rows = load_training_rows(panel_path)
    train = rows.loc[rows["split"] == "train"]
    val = rows.loc[rows["split"] == "validation"]
    test = rows.loc[rows["split"] == "test"].reset_index(drop=True)
    row_counts = {"train": int(len(train)), "validation": int(len(val)), "test": int(len(test))}

    subsample = None
    if args.max_train_rows and len(train) > args.max_train_rows:
        train = train.sample(n=args.max_train_rows, random_state=RANDOM_STATE)
        subsample = {"max_train_rows": args.max_train_rows, "seed": RANDOM_STATE}
    print(f"Rows: {row_counts}; subsample: {subsample}")

    grid = []
    for max_depth in MAX_DEPTHS:
        for min_samples_leaf in MIN_SAMPLES_LEAFS:
            model = make_model(max_depth, min_samples_leaf)
            fit_start = time.perf_counter()
            model.fit(train[FEATURE_COLUMNS], train[TARGET_COLUMN])
            fit_seconds = time.perf_counter() - fit_start
            val_metrics = score_metrics(val[TARGET_COLUMN], model.predict(val[FEATURE_COLUMNS]))
            size_mb = saved_size_mb(model)
            entry = {
                "max_depth": max_depth,
                "min_samples_leaf": min_samples_leaf,
                "val_rmse": val_metrics["rmse"],
                "val_mae": val_metrics["mae"],
                "val_r2": val_metrics["r2"],
                "file_size_mb": round(size_mb, 2),
                "fit_seconds": round(fit_seconds, 1),
                "eligible": size_mb < args.size_limit_mb,
            }
            grid.append(entry)
            print(json.dumps(entry))

    eligible = [g for g in grid if g["eligible"]]
    if not eligible:
        raise SystemExit(f"No config produced a file under {args.size_limit_mb} MB; see grid above.")
    chosen = min(eligible, key=lambda g: g["val_rmse"])
    chosen_params = {
        "n_estimators": N_ESTIMATORS,
        "max_depth": chosen["max_depth"],
        "min_samples_leaf": chosen["min_samples_leaf"],
        "random_state": RANDOM_STATE,
    }
    print(f"Chosen: {chosen_params}")

    train_full = pd.concat([train, val], ignore_index=True)
    final_model = make_model(chosen["max_depth"], chosen["min_samples_leaf"])
    refit_start = time.perf_counter()
    final_model.fit(train_full[FEATURE_COLUMNS], train_full[TARGET_COLUMN])
    refit_seconds = time.perf_counter() - refit_start

    train_mean = float(train_full[TARGET_COLUMN].mean())
    preds, fallbacks = baseline_predictions(test, train_mean)
    preds = {"model": final_model.predict(test[FEATURE_COLUMNS]), **preds}
    metrics = evaluate(test, preds)

    model_dir = Path(args.model_dir)
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / f"{MODEL_NAME}.joblib"
    joblib.dump(final_model, model_path, compress=COMPRESS)
    file_size_mb = model_path.stat().st_size / 1e6

    importances = {
        name: float(value)
        for name, value in zip(FEATURE_COLUMNS, final_model.named_steps["regressor"].feature_importances_)
    }

    overall = metrics["overall"]
    gate_check = {
        "beats_persistence_mae": overall["model"]["mae"] < overall["persistence"]["mae"],
        "beats_persistence_rmse": overall["model"]["rmse"] < overall["persistence"]["rmse"],
        "beats_mean3_mae": overall["model"]["mae"] < overall["mean3"]["mae"],
        "beats_mean3_rmse": overall["model"]["rmse"] < overall["mean3"]["rmse"],
        "file_under_size_limit": file_size_mb < args.size_limit_mb,
    }

    created_at = datetime.now(timezone.utc).isoformat()
    meta = {
        "model_name": MODEL_NAME,
        "created_at": created_at,
        "model_file": model_path.name,
        "file_size_mb": round(file_size_mb, 2),
        "feature_order": FEATURE_COLUMNS,
        "target": TARGET_COLUMN,
        "target_definition": panel_metadata["target_definition"],
        "feature_definitions": panel_metadata["feature_definitions"],
        "min_weeks_history": MIN_WEEKS_HISTORY,
        "sklearn_version": sklearn.__version__,
        "numpy_version": np.__version__,
        "joblib_version": joblib.__version__,
        "presentations": {
            "fit": sorted(TRAIN_PRESENTATIONS + VAL_PRESENTATIONS),
            "selection_train": list(TRAIN_PRESENTATIONS),
            "selection_validation": list(VAL_PRESENTATIONS),
            "test": list(TEST_PRESENTATIONS),
        },
        "params": chosen_params,
        "pipeline": "SimpleImputer(median) -> RandomForestRegressor",
        "training_rows": int(len(train_full)),
        "test_metrics": overall,
    }
    meta_path = model_dir / f"{MODEL_NAME}.meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")

    report_dir = Path(args.report_dir)
    plot_paths = save_plots(test, preds, metrics, importances, report_dir / "oulad_forecast_plots")
    report = {
        "created_at": created_at,
        "panel_path": str(panel_path),
        "panel_counts": panel_metadata["counts"],
        "focus_p90_clicks_per_active_day": panel_metadata["focus_p90_clicks_per_active_day"],
        "training_row_counts": row_counts,
        "train_subsample": subsample,
        "size_limit_mb": args.size_limit_mb,
        "grid": grid,
        "chosen_params": chosen_params,
        "refit_rows": int(len(train_full)),
        "refit_seconds": round(refit_seconds, 1),
        "baseline_train_mean": train_mean,
        "baseline_fallbacks": fallbacks,
        "test_metrics": metrics,
        "feature_importance": importances,
        "model_path": str(model_path),
        "model_file_size_mb": round(file_size_mb, 2),
        "sklearn_version": sklearn.__version__,
        "gate_check": gate_check,
        "plots": plot_paths,
        "elapsed_seconds": round(time.perf_counter() - started, 1),
    }
    report_path = report_dir / "oulad_forecast_report.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps({k: report[k] for k in ("chosen_params", "model_file_size_mb", "gate_check")}, indent=2))
    print(json.dumps(overall, indent=2))
    print(f"Model: {model_path}\nMeta: {meta_path}\nReport: {report_path}")


if __name__ == "__main__":
    main()
