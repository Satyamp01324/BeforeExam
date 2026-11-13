# BeforeExam

BeforeExam is a faculty workspace for **Srujan AI-03 — Student Performance Prediction**. It uses attendance, internal marks, and assignment scores to help faculty identify students who may need academic support before an assessment.

Faculty can review the evidence behind a flag, schedule individual or group support, and compare later internal results against the recorded baseline.

The differentiating workflow is the **Intervention Impact Simulator**: faculty can adjust attendance, internal-mark, and assignment targets for a student, preview the projected risk change without mutating real records, and convert the scenario into a support plan. This closes the loop from `detect → explain → simulate → plan → track`.

## CSV format

Use [classroom.csv](sample-data/classroom.csv) as the template. Each row is an assessment or attendance record for one student in one subject. The unique key is student ID, subject, record kind, and assessment ID. Re-importing the same key updates the record.

| Field | Rules |
|---|---|
| `kind` | `attendance`, `internal`, or `assignment` |
| `date` | ISO date, such as `2026-11-13`. Use the date the record became available for review. |
| `status` | `graded`, `pending`, or `missing`. A graded zero is a real score. |
| `score`, `max_score` | Maximum must be positive. Leave score blank for pending or missing work. |
| `topic` | Optional. Provide a topic only for a single-topic assessment or a topic-specific score. |

The seeded files use fictional names and scores. `sample-data/generate.py` reproduces them. After changing the public demo CSVs, copy the revised classroom and follow-up files to `frontend/public/samples/`.

## How alerts and evaluation work

- **Live watchlist.** The dashboard uses transparent rules for low attendance, low marks, and declining assignments. It flags academic evidence for faculty review.
- **Group suggestion.** At least two students in the same subject must score below 50% on their latest graded assignment with the same assessment ID and explicit topic. Faculty reviews and approves the membership.
- **Follow-up.** Each support plan stores the initial internal score and record cutoff for every selected student. Later internals show the score change in percentage points. The change alone does not establish that the intervention caused it.
- **Model evaluation.** Logistic regression predicts whether a later internal is below 50%. Features use only records dated before that internal. The latest cohort is held out, and its student IDs are excluded from training. Both methods receive the same alert budget. The dashboard reports caught cases, missed cases, extra alerts, and lead time. The benchmark uses a deterministic simulation and does not establish accuracy on real college records.

## Stack and scope

React, TypeScript, Vite, Tailwind CSS, Recharts, FastAPI, pandas, scikit-learn, SQLAlchemy, and SQLite. UI components are built with React and CSS. No external AI key is required.

This version is a single-workspace demo. The built frontend is served by FastAPI. To host it, use a Python-capable service and a persistent volume for SQLite. Only fictional or de-identified demo records should be used on a shared instance. Production deployment with real student data requires authentication and role-based access.
