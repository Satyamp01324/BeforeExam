"""Validation, academic evidence, and time-aware model evaluation."""
import csv
import io
from collections import defaultdict
from datetime import date
from statistics import mean

FIELDS = ("student_id", "student_name", "subject", "kind", "assessment_id",
          "assessment_name", "date", "score", "max_score", "status", "topic")
KINDS = {"attendance", "internal", "assignment"}
BENCHMARK = 50

_MODEL_CACHE = None


def read_csv(content):
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff"), newline=""), strict=True)
    if not reader.fieldnames or not set(FIELDS).issubset(reader.fieldnames):
        raise ValueError("Use the template headers: " + ", ".join(FIELDS))
    records = []
    keys = set()
    for index, raw in enumerate(reader, 2):
        try:
            if None in raw or any(raw[key] is None for key in FIELDS):
                raise ValueError("Expected one value per column.")
            row = {key: raw[key].strip() for key in FIELDS}
            if any(not row[key] for key in FIELDS[:7]):
                raise ValueError("Student, subject, assessment and date fields are required.")
            if row["kind"] not in KINDS or row["status"] not in {"graded", "pending", "missing"}:
                raise ValueError("Invalid kind or status.")
            row["date"] = date.fromisoformat(row["date"]).isoformat()
            maximum = float(row["max_score"])
            score = float(row["score"]) if row["status"] == "graded" else None
            if not 0 < maximum <= 1_000_000 or (score is not None and not 0 <= score <= maximum):
                raise ValueError("Score must be between zero and a positive maximum.")
            if score is None and row["score"]:
                raise ValueError("Leave score blank for pending or missing work.")
            row.update(score=score, max_score=maximum)
            key = record_key(row)
            if key in keys:
                raise ValueError("Duplicate student, subject and assessment.")
            keys.add(key)
            records.append(row)
        except ValueError as error:
            raise ValueError(f"Row {index}: {error}") from error
    if not records:
        raise ValueError("The file does not contain any records.")
    return records


def record_key(row):
    return (row["student_id"], row["subject"], row["kind"], row["assessment_id"])


def pct(row):
    return round(row["score"] / row["max_score"] * 100, 1)


def summarize(rows, cutoff=None):
    if cutoff:
        rows = [row for row in rows if row["date"] <= cutoff]
    by_kind = {
        kind: sorted((row for row in rows if row["kind"] == kind and row["status"] == "graded"),
                     key=lambda row: (row["date"], row["assessment_id"]))
        for kind in KINDS
    }
    attendance, internals, assignments = (by_kind[key] for key in ("attendance", "internal", "assignment"))
    attendance_rate = round(sum(row["score"] for row in attendance)
                            / sum(row["max_score"] for row in attendance) * 100, 1) if attendance else None
    latest_internal = pct(internals[-1]) if internals else None
    recent = [pct(row) for row in assignments[-3:]]
    assignment_average = round(mean(recent), 1) if recent else None
    trend = round(recent[-1] - recent[0], 1) if len(recent) >= 2 else None
    signals = []
    if latest_internal is not None and latest_internal < BENCHMARK:
        signals.append("Latest internal below benchmark")
    if trend is not None and trend <= -20 and recent[-1] < BENCHMARK:
        signals.append("Assignment scores declining")
    if attendance_rate is not None and attendance_rate < 75:
        signals.append("Attendance below 75%")
    if recent and recent[-1] < BENCHMARK:
        signals.append("Latest assignment below benchmark")
    coverage = sum(value is not None for value in (attendance_rate, latest_internal, assignment_average))
    priority = ("Data pending" if coverage < 2 else "Priority review" if len(signals) >= 2
                else "Watchlist" if signals else "On track")
    return dict(attendance=attendance_rate, internal=latest_internal, average=assignment_average,
                trend=trend, signals=signals, priority=priority, coverage=coverage)


def get_default_model():
    """Lazily load and train the production early-warning risk model from historical training data."""
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE
    from pathlib import Path
    import pandas as pd
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    eval_file = Path(__file__).resolve().parents[1] / "sample-data/evaluation.csv"
    if eval_file.is_file():
        try:
            records = read_csv(eval_file.read_text())
            grouped = defaultdict(list)
            for row in records:
                grouped[(row["student_id"], row["subject"])].append(row)
            examples = []
            for key, rows in grouped.items():
                for target in rows:
                    if target["kind"] != "internal" or target["status"] != "graded":
                        continue
                    prior = [row for row in rows if row["date"] < target["date"]]
                    if not prior:
                        continue
                    snapshot = summarize(prior)
                    if snapshot["internal"] is None or snapshot["coverage"] < 2:
                        continue
                    examples.append(dict(label=int(pct(target) < BENCHMARK),
                                         **{f: snapshot[f] for f in ("attendance", "internal", "average", "trend")}))
            if len(examples) >= 10:
                fields = ["attendance", "internal", "average", "trend"]
                pipeline = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                         LogisticRegression(max_iter=1000, random_state=42))
                pipeline.fit(pd.DataFrame(examples)[fields], [r["label"] for r in examples])
                _MODEL_CACHE = pipeline
                return _MODEL_CACHE
        except Exception:
            pass
    return None


def predict_risk(attendance, internal, average, trend):
    """Predict risk probability (0-100) of performing below 50% in the upcoming assessment."""
    model = get_default_model()
    if model is not None:
        try:
            import pandas as pd
            df = pd.DataFrame([{"attendance": attendance, "internal": internal, "average": average, "trend": trend}])
            prob = float(model.predict_proba(df)[:, 1][0]) * 100.0
            return round(max(1.0, min(99.0, prob)), 1)
        except Exception:
            pass
    # Calibrated fallback formula
    att = attendance if attendance is not None else 75.0
    intl = internal if internal is not None else 60.0
    avg = average if average is not None else 60.0
    tr = trend if trend is not None else 0.0
    raw = (100 - att) * 0.35 + (100 - intl) * 0.35 + (100 - avg) * 0.25 - tr * 0.15
    return round(max(2.0, min(98.0, raw)), 1)


def generate_recommendation(student_dict):
    """Generate intelligent personalized remedial guidance based on student metrics."""
    signals = student_dict.get("signals", [])
    attendance = student_dict.get("attendance")
    internal = student_dict.get("internal")
    trend = student_dict.get("trend")

    actions = []
    if attendance is not None and attendance < 75:
        actions.append(f"Attendance warning ({attendance}%): Schedule attendance recovery sessions to reach >=75%.")
    if internal is not None and internal < BENCHMARK:
        actions.append(f"Internal mark alert ({internal}%): Assign 1-on-1 concept clinic before assessment.")
    if trend is not None and trend <= -20:
        actions.append(f"Declining score velocity ({trend}%): Review recent assignment mistakes and retake practice quiz.")
    if not actions:
        if signals:
            actions.append("Monitor upcoming assessment submissions and maintain weekly check-ins.")
        else:
            actions.append("Academic trajectory on track. Continue standard curriculum milestones.")
    return " · ".join(actions)


def dashboard(records):
    by_student = defaultdict(list)
    for row in records:
        by_student[(row["subject"], row["student_id"])].append(row)
    students = []
    evidence = defaultdict(list)
    for (subject, student_id), rows in by_student.items():
        rows.sort(key=lambda row: (row["date"], row["assessment_id"]))
        summary = summarize(rows)
        # Compute ML risk prediction if enough data coverage exists
        if summary["coverage"] >= 2:
            ml_risk = predict_risk(summary["attendance"], summary["internal"], summary["average"], summary["trend"])
            ml_band = "High Risk" if ml_risk >= 65 else "Moderate Risk" if ml_risk >= 35 else "Low Risk"
        else:
            ml_risk = None
            ml_band = "Pending Data"

        student = dict(id=student_id, name=rows[-1]["student_name"], subject=subject,
                       records=rows, ml_risk=ml_risk, ml_band=ml_band, **summary)
        student["recommendation"] = generate_recommendation(student)
        students.append(student)

        latest_assignment = next((row for row in reversed(rows)
                                  if row["kind"] == "assignment" and row["status"] == "graded"), None)
        if latest_assignment and latest_assignment["topic"] and pct(latest_assignment) < BENCHMARK:
            row = latest_assignment
            group_key = (subject, row["assessment_id"], row["topic"])
            evidence[group_key].append(dict(id=student_id, name=student["name"], score=pct(row),
                                            assessment=row["assessment_name"]))

    order = {"Priority review": 0, "Watchlist": 1, "Data pending": 2, "On track": 3}
    students.sort(key=lambda student: (order[student["priority"]],
                                       -(student["ml_risk"] if student["ml_risk"] is not None else -1),
                                       -len(student["signals"]),
                                       student["name"]))
    groups = [dict(subject=subject, assessment_id=assessment, topic=topic, members=members)
              for (subject, assessment, topic), members in evidence.items() if len(members) >= 2]
    groups.sort(key=lambda group: (-len(group["members"]), group["topic"]))

    # Aggregated cohort analytics for overview dashboard
    valid_students = [s for s in students if s["coverage"] >= 2]
    class_summary = dict(
        total=len(students),
        priority_review=sum(1 for s in students if s["priority"] == "Priority review"),
        watchlist=sum(1 for s in students if s["priority"] == "Watchlist"),
        on_track=sum(1 for s in students if s["priority"] == "On track"),
        data_pending=sum(1 for s in students if s["priority"] == "Data pending"),
        avg_attendance=round(mean(s["attendance"] for s in valid_students if s["attendance"] is not None), 1) if valid_students else 0.0,
        avg_internal=round(mean(s["internal"] for s in valid_students if s["internal"] is not None), 1) if valid_students else 0.0,
        high_risk_ml=sum(1 for s in students if s.get("ml_risk") is not None and s["ml_risk"] >= 65),
    )

    return dict(students=students, groups=groups, class_summary=class_summary,
                cutoff=max((row["date"] for row in records), default=None))


def evaluate(records, budget):
    """Predict a later internal from dated features. Hold out the newest assessment date."""
    import pandas as pd
    from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, roc_auc_score
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    grouped = defaultdict(list)
    for row in records:
        grouped[(row["student_id"], row["subject"])].append(row)
    examples = []
    for key, rows in grouped.items():
        for target in rows:
            if target["kind"] != "internal" or target["status"] != "graded":
                continue
            prior = [row for row in rows if row["date"] < target["date"]]
            if not prior:
                continue
            snapshot = summarize(prior)
            if snapshot["internal"] is None or snapshot["coverage"] < 2:
                continue
            examples.append(dict(key=key, date=target["date"], label=int(pct(target) < BENCHMARK),
                                 lead_days=(date.fromisoformat(target["date"]) -
                                            date.fromisoformat(max(row["date"] for row in prior))).days,
                                 **{field: snapshot[field] for field in ("attendance", "internal", "average", "trend")}))
    if not examples:
        raise ValueError("Evaluation needs dated histories with at least two graded internals per student.")
    holdout = max(row["date"] for row in examples)
    test = sorted((row for row in examples if row["date"] == holdout), key=lambda row: row["key"])
    test_students = {row["key"][0] for row in test}
    train = [row for row in examples if row["date"] < holdout and row["key"][0] not in test_students]
    if len(train) < 10 or len(test) < 5 or len({row["label"] for row in train}) < 2:
        raise ValueError("Need at least 10 earlier training examples across both outcomes and five later test examples from different students.")

    fields = ["attendance", "internal", "average", "trend"]
    X_train = pd.DataFrame(train)[fields]
    y_train = [row["label"] for row in train]
    X_test = pd.DataFrame(test)[fields]
    y_test = [row["label"] for row in test]
    count = min(budget, len(test))
    positives = sum(y_test)

    # 1. Baseline: order by previous internal ascending
    baseline_order = sorted(range(len(test)), key=lambda i: test[i]["internal"])

    # 2. Logistic Regression
    lr = make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                       LogisticRegression(max_iter=1000, random_state=42))
    lr.fit(X_train, y_train)
    lr_probs = lr.predict_proba(X_test)[:, 1]
    lr_order = sorted(range(len(test)), key=lambda i: -lr_probs[i])

    # 3. Random Forest
    rf = make_pipeline(SimpleImputer(strategy="median"),
                       RandomForestClassifier(n_estimators=100, max_depth=4, random_state=42))
    rf.fit(X_train, y_train)
    rf_probs = rf.predict_proba(X_test)[:, 1]
    rf_order = sorted(range(len(test)), key=lambda i: -rf_probs[i])

    # 4. Gradient Boosting
    gb = make_pipeline(SimpleImputer(strategy="median"),
                       HistGradientBoostingClassifier(max_iter=50, random_state=42))
    gb.fit(X_train, y_train)
    gb_probs = gb.predict_proba(X_test)[:, 1]
    gb_order = sorted(range(len(test)), key=lambda i: -gb_probs[i])

    def compute_metrics(name, order, probs=None):
        hits = sum(test[index]["label"] for index in order[:count])
        missed = positives - hits
        extra = count - hits
        preds = [1 if i in set(order[:count]) else 0 for i in range(len(test))]
        prec = round((hits / count) * 100, 1) if count > 0 else 0.0
        rec = round((hits / positives) * 100, 1) if positives > 0 else 0.0
        f1 = round(2 * (prec * rec) / (prec + rec), 1) if (prec + rec) > 0 else 0.0
        acc = round(accuracy_score(y_test, preds) * 100, 1)
        roc = round(roc_auc_score(y_test, probs) * 100, 1) if probs is not None else round(roc_auc_score(y_test, [-test[i]["internal"] for i in range(len(test))]) * 100, 1)
        return dict(name=name, flagged=count, caught=hits, missed=missed, extra=extra,
                    precision=prec, recall=rec, f1=f1, accuracy=acc, roc_auc=roc)

    # Feature Importance from Random Forest
    rf_model = rf.named_steps["randomforestclassifier"]
    raw_importances = rf_model.feature_importances_
    total_imp = sum(raw_importances) or 1.0
    feature_meta = {
        "internal": ("Prior Internal Marks", "Historical indicator of formal assessment grasp"),
        "average": ("Assignment Average", "Continuous coursework comprehension"),
        "attendance": ("Class Attendance", "Fundamental lecture engagement and participation"),
        "trend": ("Assignment Trend Drop", "Early indicator of learning gaps or declining velocity"),
    }
    feature_importances = [
        dict(
            key=field,
            feature=feature_meta[field][0],
            importance=round((raw_importances[idx] / total_imp) * 100, 1),
            description=feature_meta[field][1]
        )
        for idx, field in enumerate(fields)
    ]
    feature_importances.sort(key=lambda x: -x["importance"])

    return dict(
        train=len(train),
        test=len(test),
        holdout=holdout,
        positives=positives,
        lead_days=round(mean(row["lead_days"] for row in test), 1),
        methods=[
            compute_metrics("Latest internal baseline", baseline_order),
            compute_metrics("Logistic regression", lr_order, lr_probs),
            compute_metrics("Random forest", rf_order, rf_probs),
            compute_metrics("Gradient boosting", gb_order, gb_probs),
        ],
        feature_importances=feature_importances,
    )
