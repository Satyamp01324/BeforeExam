# BeforeExam

BeforeExam is a faculty workspace for **Srujan AI-03 — Student Performance Prediction**. It uses attendance, internal marks, and assignment scores to help faculty identify students who may need academic support before an assessment.

Faculty can review the evidence behind a flag, schedule individual or group support, and compare later internal results against the recorded baseline.

The differentiating workflow is the **Intervention Impact Simulator**: faculty can adjust attendance, internal-mark, and assignment targets for a student, preview the projected risk change without mutating real records, and convert the scenario into a support plan. This closes the loop from `detect → explain → simulate → plan → track`.

## Run locally

You need **Python 3.12** and **Node.js 22.12+** (or Node.js 24).

From the repository root:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

On Windows PowerShell, activate the environment with `.venv\Scripts\Activate.ps1`. Open <http://127.0.0.1:8000>. Interactive API docs are at <http://127.0.0.1:8000/docs>.

For frontend development, run Uvicorn with `--reload` in one terminal and `npm --prefix frontend run dev` in another. Open the URL Vite prints.

## Three-minute demo

1. Open the overview. It starts with a fictional DBMS class of 24 students.
2. Open **Aarav Mehta**, then search for **Riya Shah** in Students. Both average 12/20 in assignments, but their score histories move in opposite directions.
3. Return to Overview and open **Suggested support → SQL Joins → Review group**. Review the six students and save the revision session. Optionally assign Kabir an individual academic check-in.
4. Open a student and select **Simulate support impact**. Move the sliders to preview a realistic intervention scenario, then convert it into a support plan.
5. In **Import records**, click **Load sample follow-up**. Return to **Support plans** to see baseline and follow-up internal scores and update the plan status.
6. Open **Model evaluation** and run the fixed-budget comparison on the simulated historical dataset.

SQLite stores imported data and support plans between sessions. For a clean demo, start the app with a new database path through the `BEFOREEXAM_DB` environment variable. Assessment dates are saved in the current browser.

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

Run backend checks with `python -m unittest discover -s backend -p 'test_*.py'`.

## References

The workflow draws on [DropoutGuard](https://github.com/Dhrupal-01/dropout-risk-ai), the time-aware evaluation draws on [JdenLee's Student Early Warning System](https://github.com/JdenLee/student-early-warning-system), and the academic input design draws on [disha-birari's Student Performance Prediction](https://github.com/disha-birari/student-performance-prediction). This repository implements its own application and uses generated demonstration records.
