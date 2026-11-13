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


def dashboard(records):
    by_student = defaultdict(list)
    for row in records:
        by_student[(row["subject"], row["student_id"])].append(row)
    students = []
    evidence = defaultdict(list)
    for (subject, student_id), rows in by_student.items():
        rows.sort(key=lambda row: (row["date"], row["assessment_id"]))
        summary = summarize(rows)
        student = dict(id=student_id, name=rows[-1]["student_name"], subject=subject,
                       records=rows, **summary)
        students.append(student)
        latest_assignment = next((row for row in reversed(rows)
                                  if row["kind"] == "assignment" and row["status"] == "graded"), None)
        if latest_assignment and latest_assignment["topic"] and pct(latest_assignment) < BENCHMARK:
            row = latest_assignment
            group_key = (subject, row["assessment_id"], row["topic"])
            evidence[group_key].append(dict(id=student_id, name=student["name"], score=pct(row),
                                            assessment=row["assessment_name"]))
    order = {"Priority review": 0, "Watchlist": 1, "Data pending": 2, "On track": 3}
    students.sort(key=lambda student: (order[student["priority"]], -len(student["signals"]), student["name"]))
    groups = [dict(subject=subject, assessment_id=assessment, topic=topic, members=members)
              for (subject, assessment, topic), members in evidence.items() if len(members) >= 2]
    groups.sort(key=lambda group: (-len(group["members"]), group["topic"]))
    return dict(students=students, groups=groups, cutoff=max((row["date"] for row in records), default=None))


def evaluate(records, budget):
    """Predict a later internal from dated features. Hold out the newest assessment date."""
    import pandas as pd
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
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
    model = make_pipeline(SimpleImputer(strategy="median", add_indicator=True), StandardScaler(),
                          LogisticRegression(max_iter=1000))
    model.fit(pd.DataFrame(train)[fields], [row["label"] for row in train])
    probabilities = model.predict_proba(pd.DataFrame(test)[fields])[:, 1]
    count = min(budget, len(test))
    positives = sum(row["label"] for row in test)

    def results(name, order):
        hits = sum(test[index]["label"] for index in order[:count])
        return dict(name=name, flagged=count, caught=hits, missed=positives - hits, extra=count - hits)

    return dict(train=len(train), test=len(test), holdout=holdout, positives=positives,
                lead_days=round(mean(row["lead_days"] for row in test), 1),
                methods=[results("Latest internal baseline", sorted(range(len(test)), key=lambda i: test[i]["internal"])),
                         results("Logistic regression", sorted(range(len(test)), key=lambda i: -probabilities[i]))])
