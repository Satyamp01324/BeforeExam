"""Generate deterministic fictional classroom and evaluation data."""
from pathlib import Path
from datetime import date, timedelta
import csv
import random

ROOT = Path(__file__).parent
FIELDS = ("student_id", "student_name", "subject", "kind", "assessment_id",
          "assessment_name", "date", "score", "max_score", "status", "topic")


def write(name, rows):
    with (ROOT / name).open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(FIELDS)
        writer.writerows(rows)


def event(student, kind, identifier, title, day, score, maximum, topic=""):
    return (*student, kind, identifier, title, day, score, maximum,
            "pending" if score == "" else "graded", topic)


names = ["Aarav Mehta", "Riya Shah", "Kabir Rao", "Meera Joshi", "Ananya Patil",
         "Ishaan Verma", "Sara Khan", "Dev Kulkarni", "Vihaan Desai", "Nisha More",
         "Aditya Jain", "Priya Naik", "Rohan Singh", "Aisha Sheikh", "Neil Fernandes",
         "Tanvi Ghosh", "Om Chavan", "Zoya Khan", "Parth Joshi", "Diya Menon",
         "Mihir Shah", "Ira Gupta", "Jay Pawar", "Neha Rao"]
group = {0, 4, 5, 6, 7, 8}
classroom, followup = [], []
for index, name in enumerate(names):
    student = (f"CE-{101 + index}", name, "Database Management Systems")
    attend = 82 if index in {0, 1} else 65 if index == 2 else 80 + index % 17
    internal = 13 if index in {0, 1} else "" if index == 3 else 10 if index in group else 16 + index % 8
    scores = ([17, 12, 7] if index == 0 else [11, 12, 13] if index == 1 else ["", "", ""] if index == 3
              else [15, 11, 8 + index % 2] if index in group else [12 + index % 6, 13 + index % 5, 14 + index % 6])
    classroom.append(event(student, "attendance", "att-1", "Attendance to date", "2026-11-13", attend, 100))
    classroom.append(event(student, "internal", "int-1", "Internal 1", "2026-11-03", internal, 25))
    for offset, score in enumerate(scores):
        classroom.append(event(student, "assignment", f"a-{offset + 1}",
                               ("Relational model", "SQL filters", "SQL Joins quiz")[offset],
                               ("2026-11-02", "2026-11-06", "2026-11-12")[offset], score, 20,
                               "SQL Joins" if offset == 2 else ""))
    followup.append(event(student, "internal", "int-2", "Internal 2", "2026-11-21",
                          10 if index in {5, 8} else 17 + index % 6, 25))

write("classroom.csv", classroom)
write("follow-up.csv", followup)

random.seed(83)
historical = []
for index in range(100):
    month = 9 if index < 72 else 10
    start = date(2026, month, 1)
    student = (f"SIM-{index:03}", f"Sample student {index}", "Database Management Systems")
    first = random.randint(8, 22)
    attendance = random.randint(60, 99)
    first_assignment = random.randint(8, 19)
    last_assignment = random.randint(4, 19)
    outcome = round(first * .55 + last_assignment * .39 + (attendance - 70) * .08
                    + random.uniform(-4, 4))
    historical.extend([
        event(student, "internal", "historical-1", "Internal 1", start.isoformat(), first, 25),
        event(student, "assignment", "h-a1", "Assignment 1", (start + timedelta(days=2)).isoformat(), first_assignment, 20),
        event(student, "assignment", "h-a2", "Assignment 2", (start + timedelta(days=6)).isoformat(), last_assignment, 20),
        event(student, "attendance", "h-att", "Attendance", (start + timedelta(days=7)).isoformat(), attendance, 100),
        event(student, "internal", "historical-2", "Internal 2", (start + timedelta(days=14)).isoformat(),
              min(25, max(0, outcome)), 25),
    ])
write("evaluation.csv", historical)
