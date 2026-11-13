"""BeforeExam API. Run from the repository root."""
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
import csv
import io
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import JSON, Column, String, create_engine, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import DeclarativeBase, Session

from .domain import FIELDS, dashboard, evaluate, predict_risk, read_csv

ROOT = Path(__file__).resolve().parents[1]
DATABASE = os.environ.get("BEFOREEXAM_DB", str(ROOT / "beforeexam.sqlite3"))
engine = create_engine("sqlite:///" + DATABASE, connect_args={"timeout": 20})


class Base(DeclarativeBase):
    pass


class Record(Base):
    __tablename__ = "academic_records"
    student_id = Column(String, primary_key=True)
    subject = Column(String, primary_key=True)
    kind = Column(String, primary_key=True)
    assessment_id = Column(String, primary_key=True)
    payload = Column(JSON, nullable=False)


class Plan(Base):
    __tablename__ = "support_plans"
    id = Column(String, primary_key=True)
    payload = Column(JSON, nullable=False)


def upsert(db, rows):
    for row in rows:
        statement = insert(Record).values(student_id=row["student_id"], subject=row["subject"],
                                          kind=row["kind"], assessment_id=row["assessment_id"],
                                          payload=row)
        db.execute(statement.on_conflict_do_update(
            index_elements=["student_id", "subject", "kind", "assessment_id"],
            set_={"payload": statement.excluded.payload},
        ))


def records(db):
    return [record.payload for record in db.scalars(select(Record))]


@asynccontextmanager
async def lifespan(_app):
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        if db.scalar(select(Record).limit(1)) is None:
            upsert(db, read_csv((ROOT / "sample-data/classroom.csv").read_text()))
            db.commit()
    yield


app = FastAPI(title="BeforeExam", lifespan=lifespan)


@app.get("/api/dashboard")
def get_dashboard():
    with Session(engine) as db:
        return {**dashboard(records(db)), "plans": [plan.payload for plan in db.scalars(select(Plan))]}


@app.post("/api/import")
async def import_data(request: Request):
    body = await request.body()
    if len(body) > 2_000_000:
        raise HTTPException(413, "CSV exceeds the 2 MB limit.")
    try:
        rows = read_csv(body.decode("utf-8-sig"))
    except (ValueError, csv.Error) as error:
        raise HTTPException(422, str(error)) from error
    with Session(engine) as db:
        upsert(db, rows)
        db.commit()
    return {"imported": len(rows)}


class SimulationInput(BaseModel):
    attendance: float = Field(ge=0, le=100)
    internal: float = Field(ge=0, le=100)
    average: float = Field(ge=0, le=100)
    trend: float = Field(ge=-100, le=100, default=0.0)


@app.post("/api/simulate")
def run_simulation(sim: SimulationInput):
    ml_risk = predict_risk(sim.attendance, sim.internal, sim.average, sim.trend)
    heuristic_risk = round(max(0, min(100, (100 - sim.attendance) * 0.35 + (100 - sim.internal) * 0.35 + (100 - sim.average) * 0.30)))
    band = "High Risk" if ml_risk >= 65 else "Moderate Risk" if ml_risk >= 35 else "Low Risk"
    return {
        "ml_risk": ml_risk,
        "heuristic_risk": heuristic_risk,
        "band": band,
    }


@app.get("/api/export")
def export_report():
    with Session(engine) as db:
        dash = dashboard(records(db))

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Student ID", "Name", "Subject", "Priority Status", "ML Failure Risk %",
        "Risk Band", "Attendance %", "Latest Internal %", "Assignment Average %",
        "Score Trend", "Review Signals", "Smart Recommendation"
    ])
    for s in dash["students"]:
        writer.writerow([
            s["id"], s["name"], s["subject"], s["priority"],
            s["ml_risk"] if s.get("ml_risk") is not None else "N/A",
            s.get("ml_band", "N/A"),
            s["attendance"] if s["attendance"] is not None else "N/A",
            s["internal"] if s["internal"] is not None else "N/A",
            s["average"] if s["average"] is not None else "N/A",
            f"{s['trend']:+g}%" if s["trend"] is not None else "N/A",
            "; ".join(s["signals"]) if s["signals"] else "None",
            s.get("recommendation", "")
        ])
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=beforeexam-faculty-report.csv"}
    )


class PlanInput(BaseModel):
    subject: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=120)
    members: list[str] = Field(min_length=1, max_length=200)
    review_date: date
    assessment_id: str | None = None


@app.post("/api/plans", status_code=201)
def create_plan(plan: PlanInput):
    import uuid
    with Session(engine) as db:
        students = {student["id"]: student for student in dashboard(records(db))["students"]
                    if student["subject"] == plan.subject}
        if len(set(plan.members)) != len(plan.members) or any(member not in students for member in plan.members):
            raise HTTPException(422, "Choose unique students from this subject.")
        title = plan.title.strip()
        if not title:
            raise HTTPException(422, "Enter a support action.")
        if plan.assessment_id:
            groups = dashboard(records(db))["groups"]
            eligible = {member["id"] for group in groups
                        if group["subject"] == plan.subject and group["assessment_id"] == plan.assessment_id
                        for member in group["members"]}
            if not set(plan.members) <= eligible:
                raise HTTPException(422, "Group evidence has changed. Refresh the dashboard.")
        plan_id = uuid.uuid4().hex
        payload = {**plan.model_dump(mode="json"), "id": plan_id, "title": title, "status": "Scheduled",
                   "baseline": {member: {"internal": students[member]["internal"],
                                         "cutoff": max(row["date"] for row in students[member]["records"])}
                                 for member in plan.members}}
        db.add(Plan(id=plan_id, payload=payload))
        db.commit()
        return payload


class PlanReview(BaseModel):
    status: str


@app.patch("/api/plans/{plan_id}")
def review_plan(plan_id: str, review: PlanReview):
    if review.status not in {"Scheduled", "Monitoring", "Closed"}:
        raise HTTPException(422, "Choose a valid status.")
    with Session(engine) as db:
        plan = db.get(Plan, plan_id)
        if plan is None:
            raise HTTPException(404, "Support plan not found.")
        plan.payload = {**plan.payload, "status": review.status}
        db.commit()
        return plan.payload


@app.get("/api/evaluation")
def model_evaluation():
    try:
        rows = read_csv((ROOT / "sample-data/evaluation.csv").read_text())
        return evaluate(rows, budget=10)
    except (ValueError, csv.Error) as error:
        raise HTTPException(422, str(error)) from error


dist = ROOT / "frontend/dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
