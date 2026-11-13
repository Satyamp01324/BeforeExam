import csv
import io
import unittest
from pathlib import Path

from backend.domain import FIELDS, dashboard, evaluate, read_csv, summarize

SAMPLES = Path(__file__).resolve().parents[1] / "sample-data"


class AcademicWorkflowTests(unittest.TestCase):
    def test_shared_assessment_uses_evidence_and_preserves_opposite_trends(self):
        result = dashboard(read_csv((SAMPLES / "classroom.csv").read_text()))
        self.assertEqual(len(result["students"]), 24)
        self.assertEqual([(group["topic"], len(group["members"])) for group in result["groups"]],
                         [("SQL Joins", 6)])
        students = {student["id"]: student for student in result["students"]}
        self.assertEqual(students["CE-101"]["average"], students["CE-102"]["average"])
        self.assertLess(students["CE-101"]["trend"], 0)
        self.assertGreater(students["CE-102"]["trend"], 0)
        self.assertEqual(students["CE-104"]["priority"], "Data pending")
        # ML risk and recommendations
        self.assertIn("ml_risk", students["CE-101"])
        self.assertIsNotNone(students["CE-101"]["ml_risk"])
        self.assertGreater(students["CE-101"]["ml_risk"], students["CE-102"]["ml_risk"])
        self.assertIn("recommendation", students["CE-101"])
        self.assertIn("class_summary", result)
        self.assertEqual(result["class_summary"]["total"], 24)

    def test_graded_zero_is_distinct_from_pending(self):
        content = io.StringIO()
        writer = csv.writer(content)
        writer.writerow(FIELDS)
        writer.writerow(("X", "Student", "DBMS", "assignment", "a1", "Quiz", "2026-11-04", 0, 20, "graded", ""))
        writer.writerow(("X", "Student", "DBMS", "assignment", "a2", "Quiz 2", "2026-11-05", "", 20, "pending", ""))
        rows = read_csv(content.getvalue())
        self.assertEqual([row["score"] for row in rows], [0, None])
        self.assertEqual(summarize(rows)["average"], 0)

    def test_equal_budget_and_temporal_holdout(self):
        result = evaluate(read_csv((SAMPLES / "evaluation.csv").read_text()), budget=10)
        self.assertEqual((result["train"], result["test"], result["lead_days"]), (72, 28, 7))
        self.assertEqual(len(result["methods"]), 4)
        self.assertEqual([m["name"] for m in result["methods"]],
                         ["Latest internal baseline", "Logistic regression", "Random forest", "Gradient boosting"])
        for method in result["methods"]:
            self.assertEqual(method["flagged"], 10)
            self.assertEqual(method["extra"] + method["caught"], 10)
            self.assertEqual(method["missed"] + method["caught"], result["positives"])
            self.assertIn("precision", method)
            self.assertIn("recall", method)
            self.assertIn("f1", method)
            self.assertIn("roc_auc", method)
        self.assertIn("feature_importances", result)
        self.assertEqual(len(result["feature_importances"]), 4)
