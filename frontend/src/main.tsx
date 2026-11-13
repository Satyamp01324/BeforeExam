import { StrictMode, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen,
  CalendarDays, ChartNoAxesCombined, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ClipboardList,
  Database, FileUp, GraduationCap, LayoutDashboard, ListFilter, Search, ShieldAlert, SlidersHorizontal, Sparkles, TrendingDown, TrendingUp, Users, X,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './styles.css'

type Priority = 'Priority review' | 'Watchlist' | 'Data pending' | 'On track'
type Entry = { kind: string; assessment_id: string; assessment_name: string; date: string; score: number | null; max_score: number; status: string; topic: string }
type Student = {
  id: string
  name: string
  subject: string
  attendance: number | null
  internal: number | null
  average: number | null
  trend: number | null
  signals: string[]
  priority: Priority
  ml_risk: number | null
  ml_band: string
  recommendation?: string
  records: Entry[]
}
type Group = { subject: string; assessment_id: string; topic: string; members: { id: string; name: string; score: number; assessment: string }[] }
type Plan = { id: string; title: string; subject: string; members: string[]; review_date: string; status: string; baseline: Record<string, { internal: number | null; cutoff: string }> }
type ClassSummary = {
  total: number
  priority_review: number
  watchlist: number
  on_track: number
  data_pending: number
  avg_attendance: number
  avg_internal: number
  high_risk_ml: number
}
type Data = { students: Student[]; groups: Group[]; plans: Plan[]; cutoff: string | null; class_summary?: ClassSummary }
type MethodEval = {
  name: string
  flagged: number
  caught: number
  missed: number
  extra: number
  accuracy?: number
  precision?: number
  recall?: number
  f1?: number
  roc_auc?: number
}
type FeatureImportance = {
  key: string
  feature: string
  importance: number
  description: string
}
type Eval = {
  train: number
  test: number
  holdout: string
  positives: number
  lead_days: number
  methods: MethodEval[]
  feature_importances?: FeatureImportance[]
}
type Draft = { title: string; subject: string; candidates: { id: string; name: string; score?: number }[]; assessment_id?: string }
type Page = 'Overview' | 'Students' | 'Support plans' | 'Model evaluation'

const nav = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Students', icon: Users },
  { label: 'Support plans', icon: ClipboardList },
  { label: 'Model evaluation', icon: ChartNoAxesCombined },
] as const

const priorities: Priority[] = ['Priority review', 'Watchlist', 'On track', 'Data pending']
const colors: Record<Priority, string> = { 'Priority review': 'rose', Watchlist: 'amber', 'On track': 'mint', 'Data pending': 'slate' }
const sampleSubject = 'Database Management Systems'

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(typeof payload.detail === 'string' ? payload.detail : `Request failed (${response.status}).`)
  }
  return response.json()
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

function dateLabel(value: string) {
  return new Date(value + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function percent(value: number | null) { return value === null ? '—' : `${value}%` }
function initials(name: string) { return name.split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase() }

function Badge({ value }: { value: Priority }) {
  return <span className={'badge ' + colors[value]}><i />{value}</span>
}

function MLRiskPill({ risk, band }: { risk: number | null; band?: string }) {
  if (risk === null) return <span className="ml-pill slate">Data pending</span>
  const tone = risk >= 65 ? 'rose' : risk >= 35 ? 'amber' : 'mint'
  return <span className={'ml-pill ' + tone} title={`ML predicted failure risk: ${risk}%`}>
    <Sparkles size={11}/> {risk}% {band ? band.replace(' Risk', '') : 'Risk'}
  </span>
}

function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} onCancel={close} className="modal" aria-labelledby="dialog-title">
    <div className="modal-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close"><X size={20}/></button></div>
    {children}
  </dialog>
}

function Stat({ icon, tone, label, value, note }: { icon: ReactNode; tone: string; label: string; value: number | string; note: string }) {
  return <div className="stat"><div className={'stat-icon ' + tone}>{icon}</div><div className="stat-label">{label}</div><strong>{value}</strong><small>{note}</small></div>
}

function CohortAnalytics({ students }: { students: Student[] }) {
  const total = students.length
  if (!total) return null

  const pReview = students.filter(s => s.priority === 'Priority review').length
  const watchlist = students.filter(s => s.priority === 'Watchlist').length
  const onTrack = students.filter(s => s.priority === 'On track').length
  const pending = students.filter(s => s.priority === 'Data pending').length

  // Quadrant categorization
  const critical = students.filter(s => (s.attendance ?? 100) < 75 && (s.internal ?? 100) < 50).length
  const conceptGap = students.filter(s => (s.attendance ?? 0) >= 75 && (s.internal ?? 100) < 50).length
  const attendGap = students.filter(s => (s.attendance ?? 100) < 75 && (s.internal ?? 0) >= 50).length
  const safe = students.filter(s => (s.attendance ?? 0) >= 75 && (s.internal ?? 0) >= 50).length

  return <section className="analytics-grid">
    <div className="panel padded">
      <div className="panel-heading flush">
        <div>
          <h2>Cohort Risk Distribution</h2>
          <p>Class-wide distribution based on academic warning signals and AI model.</p>
        </div>
      </div>
      <div className="distribution-bar">
        <div className="dist-segment" style={{ width: `${(pReview / total) * 100}%`, background: '#f43f5e' }} title={`Priority review: ${pReview}`}/>
        <div className="dist-segment" style={{ width: `${(watchlist / total) * 100}%`, background: '#f59e0b' }} title={`Watchlist: ${watchlist}`}/>
        <div className="dist-segment" style={{ width: `${(onTrack / total) * 100}%`, background: '#10b981' }} title={`On track: ${onTrack}`}/>
        <div className="dist-segment" style={{ width: `${(pending / total) * 100}%`, background: '#94a3b8' }} title={`Data pending: ${pending}`}/>
      </div>
      <div className="dist-legend">
        <span className="dist-item"><span className="dist-dot" style={{ background: '#f43f5e' }}/> Priority review ({pReview})</span>
        <span className="dist-item"><span className="dist-dot" style={{ background: '#f59e0b' }}/> Watchlist ({watchlist})</span>
        <span className="dist-item"><span className="dist-dot" style={{ background: '#10b981' }}/> On track ({onTrack})</span>
        <span className="dist-item"><span className="dist-dot" style={{ background: '#94a3b8' }}/> Data pending ({pending})</span>
      </div>
    </div>

    <div className="panel padded">
      <div className="panel-heading flush">
        <div>
          <h2>Diagnostic Quadrants</h2>
          <p>Categorizing students by Lecture Attendance vs. Internal Assessment Mastery.</p>
        </div>
      </div>
      <div className="quadrant-grid">
        <div className="quadrant-box danger">
          <div className="quadrant-title"><span>Critical Double-Risk</span><span className="quadrant-count">{critical}</span></div>
          <small>Attendance &lt;75% &amp; Marks &lt;50%</small>
        </div>
        <div className="quadrant-box concept">
          <div className="quadrant-title"><span>Concept Tutoring Gap</span><span className="quadrant-count">{conceptGap}</span></div>
          <small>High attendance, struggling in exams</small>
        </div>
        <div className="quadrant-box attendance">
          <div className="quadrant-title"><span>Attendance Recovery</span><span className="quadrant-count">{attendGap}</span></div>
          <small>Passing marks, attendance &lt;75%</small>
        </div>
        <div className="quadrant-box safe">
          <div className="quadrant-title"><span>Mastered &amp; On Track</span><span className="quadrant-count">{safe}</span></div>
          <small>Attendance &ge;75% &amp; Marks &ge;50%</small>
        </div>
      </div>
    </div>
  </section>
}

function StudentTable({ students, select, compact = false }: { students: Student[]; select: (student: Student) => void; compact?: boolean }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All statuses')
  const filtered = students.filter(student => {
    const matchesSearch = (student.name + ' ' + student.id).toLowerCase().includes(search.trim().toLowerCase())
    if (!matchesSearch) return false
    if (filter === 'All statuses') return true
    if (filter === 'High ML Risk (>65%)') return (student.ml_risk ?? 0) >= 65
    return filter === student.priority
  })

  return <section className="panel student-panel">
    <div className="panel-heading">
      <div>
        <h2>{compact ? 'Student watchlist' : 'Student directory'}</h2>
        <p>{compact ? 'Review students flagged for early academic intervention.' : 'Search the class and open a student’s diagnostic profile.'}</p>
      </div>
    </div>
    <div className="table-tools">
      <label className="search"><Search size={16}/><input aria-label="Search students" placeholder="Search students..." value={search} onChange={event => setSearch(event.target.value)}/></label>
      <label className="filter"><ListFilter size={16}/><select aria-label="Filter students by priority" value={filter} onChange={event => setFilter(event.target.value)}>
        {['All statuses', 'High ML Risk (>65%)', ...priorities].map(value => <option key={value}>{value}</option>)}
      </select></label>
    </div>
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th>Rule Status</th>
            <th>AI Failure Risk</th>
            <th>Attendance</th>
            <th>Latest Internal</th>
            <th><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody>
          {filtered.slice(0, compact && !search && filter === 'All statuses' ? 8 : undefined).map((student, index) => <tr key={student.id}>
            <td>
              <button className="student-name" onClick={() => select(student)}>
                <span className={'avatar avatar-' + index % 4}>{initials(student.name)}</span>
                <span>{student.name}<small>{student.id}</small></span>
              </button>
            </td>
            <td><Badge value={student.priority}/></td>
            <td><MLRiskPill risk={student.ml_risk} band={student.ml_band}/></td>
            <td>{percent(student.attendance)}</td>
            <td>{percent(student.internal)}</td>
            <td><button className="icon-button row-arrow" onClick={() => select(student)} aria-label={'Open ' + student.name}><ChevronRight size={17}/></button></td>
          </tr>)}
        </tbody>
      </table>
      {!filtered.length && <p className="empty">No students match these filters.</p>}
    </div>
  </section>
}

function StudentDetail({ student, back, action, plans }: { student: Student; back: () => void; action: () => void; plans: Plan[] }) {
  const [simulator, setSimulator] = useState(false)
  const attendanceNow = student.attendance ?? 0
  const internalNow = student.internal ?? 0
  const assignmentNow = student.average ?? 0
  const trendNow = student.trend ?? 0

  const [attendanceTarget, setAttendanceTarget] = useState(Math.round(attendanceNow))
  const [internalTarget, setInternalTarget] = useState(Math.round(internalNow))
  const [assignmentTarget, setAssignmentTarget] = useState(Math.round(assignmentNow))

  // Heuristic rule risk
  const ruleRisk = (attendance: number, internal: number, assignment: number) =>
    Math.round(Math.max(0, Math.min(100, (100 - attendance) * .35 + (100 - internal) * .35 + (100 - assignment) * .30)))

  // ML Risk approximation (calibrated with backend trained logistic regression)
  const mlPredict = (att: number, intl: number, avg: number, tr: number) => {
    const logit = 4.2 - 0.038 * att - 0.078 * intl - 0.045 * avg - 0.012 * tr
    const prob = 1 / (1 + Math.exp(-logit))
    return Math.round(Math.max(1, Math.min(99, prob * 1000)) / 10)
  }

  const currentRuleRisk = ruleRisk(attendanceNow, internalNow, assignmentNow)
  const currentMLRisk = student.ml_risk ?? mlPredict(attendanceNow, internalNow, assignmentNow, trendNow)

  const projectedRuleRisk = ruleRisk(attendanceTarget, internalTarget, assignmentTarget)
  const simulatedTrend = Math.max(trendNow, Math.round(assignmentTarget - assignmentNow))
  const projectedMLRisk = mlPredict(attendanceTarget, internalTarget, assignmentTarget, simulatedTrend)

  const ruleImprovement = Math.max(0, currentRuleRisk - projectedRuleRisk)
  const mlImprovement = Math.max(0, Math.round((currentMLRisk - projectedMLRisk) * 10) / 10)

  const nextAction = attendanceTarget - attendanceNow >= 8 ? 'Attendance recovery check-in' : internalTarget - internalNow >= 8 ? 'Internal-mark revision clinic' : 'Targeted assignment practice'
  const chart = student.records.filter(row => row.kind === 'assignment' && row.status === 'graded')
    .map(row => ({ name: row.assessment_name, score: Math.round((row.score ?? 0) / row.max_score * 100) }))

  return <>
    <button className="text-button back" onClick={back}><ArrowLeft size={16}/> Back to students</button>
    <div className="page-heading">
      <div>
        <h1>{student.name}</h1>
        <p>{student.id} · {student.subject}</p>
      </div>
      <div className="page-actions">
        <button className="button" onClick={() => setSimulator(value => !value)}>
          <SlidersHorizontal size={17}/> {simulator ? 'Close simulator' : 'Simulate support impact'}
        </button>
        <button className="button primary" onClick={action}>
          <ClipboardList size={17}/> Plan support
        </button>
      </div>
    </div>

    {/* AI Failure Risk Diagnostic Banner */}
    <div className="ai-risk-card">
      <div className="ai-risk-header">
        <div>
          <span className="eyebrow"><Sparkles size={13}/> Machine Learning Diagnostic Assessment</span>
          <h2>AI Failure Risk: {currentMLRisk}% ({student.ml_band || (currentMLRisk >= 65 ? 'High Risk' : currentMLRisk >= 35 ? 'Moderate Risk' : 'Low Risk')})</h2>
        </div>
        <MLRiskPill risk={currentMLRisk} band={student.ml_band}/>
      </div>
      <div className="ai-risk-bar">
        <div className={'ai-risk-fill ' + (currentMLRisk >= 65 ? 'rose' : currentMLRisk >= 35 ? 'amber' : 'mint')}
             style={{ width: `${currentMLRisk}%` }}/>
      </div>
      {student.recommendation && <div className="recommendation-card">
        <h3><CheckCircle2 size={16}/> Personalized Remedial Action Pathway</h3>
        <p>{student.recommendation}</p>
      </div>}
    </div>

    {/* Intervention Impact Simulator */}
    {simulator && <section className="panel simulator">
      <div className="simulator-head">
        <div>
          <span className="eyebrow"><Sparkles size={13}/> Non-destructive Intervention Scenario</span>
          <h2>Dual Simulation: Projecting Rule &amp; AI Risk Reduction</h2>
          <p>Adjust attendance or performance targets to preview how targeted interventions lower projected failure probability.</p>
        </div>
        <div className="sim-score">
          <strong>{projectedMLRisk}%</strong>
          <span>projected ML risk</span>
        </div>
      </div>
      <div className="sim-grid">
        <div className="sim-controls">
          <label>Attendance target <output>{attendanceTarget}%</output>
            <input type="range" min="40" max="100" value={attendanceTarget} onChange={event => setAttendanceTarget(Number(event.target.value))}/>
          </label>
          <label>Internal marks target <output>{internalTarget}%</output>
            <input type="range" min="0" max="100" value={internalTarget} onChange={event => setInternalTarget(Number(event.target.value))}/>
          </label>
          <label>Assignment average target <output>{assignmentTarget}%</output>
            <input type="range" min="0" max="100" value={assignmentTarget} onChange={event => setAssignmentTarget(Number(event.target.value))}/>
          </label>
        </div>
        <div className="sim-result">
          <div className="risk-compare">
            <div><small>Current ML Risk</small><strong>{currentMLRisk}%</strong></div>
            <span>→</span>
            <div><small>Projected Scenario</small><strong className={mlImprovement >= 10 ? 'good' : ''}>{projectedMLRisk}%</strong></div>
          </div>
          <p>
            {mlImprovement ? <><b>{mlImprovement}% drop in ML risk</b> (and {ruleImprovement} pt rule reduction) if targets are reached.</> : 'Adjust a slider to preview projected academic impact.'}
          </p>
          <div className="next-action">
            <Sparkles size={16}/>
            <span><b>Recommended Faculty Intervention</b>{nextAction}</span>
          </div>
          <button className="button primary" onClick={action}>
            <ClipboardList size={16}/> Turn scenario into support plan
          </button>
        </div>
      </div>
    </section>}

    <div className="detail-grid">
      <section className="panel padded">
        <div className="panel-heading flush">
          <div>
            <h2>Assignment Performance Timeline</h2>
            <p>Score progression across coursework assessments.</p>
          </div>
        </div>
        {chart.length ? <div className="chart">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={chart} margin={{ top: 20, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid stroke="#e7edf1" vertical={false}/>
              <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false}/>
              <YAxis domain={[0, 100]} width={36} tick={{ fontSize: 11 }} tickLine={false}/>
              <Tooltip formatter={value => `${value}%`}/>
              <Line type="linear" dataKey="score" name="Score" stroke="#098679" strokeWidth={3} dot={{ r: 5 }}/>
            </LineChart>
          </ResponsiveContainer>
        </div> : <p className="empty">No graded assignments yet.</p>}
      </section>

      <section className="panel padded evidence">
        <h2>Evidence &amp; Academic Metrics</h2>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <Badge value={student.priority}/>
          <MLRiskPill risk={student.ml_risk} band={student.ml_band}/>
        </div>
        <dl>
          <div><dt>Attendance</dt><dd>{percent(student.attendance)}</dd></div>
          <div><dt>Latest internal</dt><dd>{percent(student.internal)}</dd></div>
          <div><dt>Assignment average</dt><dd>{percent(student.average)}</dd></div>
          <div><dt>Score trajectory</dt><dd style={{ color: (student.trend ?? 0) < 0 ? '#b71c1c' : '#1b5e20' }}>{student.trend !== null ? `${student.trend > 0 ? '+' : ''}${student.trend}%` : '—'}</dd></div>
        </dl>
        {student.signals.length ? <ul>{student.signals.map(signal => <li key={signal}>{signal}</li>)}</ul> : <p>No adverse signals in the available records.</p>}
      </section>
    </div>

    <section className="panel detail-records">
      <div className="panel-heading">
        <div>
          <h2>Academic Records</h2>
          <p>Chronological history used for risk calculations.</p>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead><tr><th>Assessment</th><th>Date</th><th>Topic</th><th>Score</th></tr></thead>
          <tbody>
            {[...student.records].reverse().map(row => <tr key={row.kind + row.assessment_id}>
              <td>{row.assessment_name}</td>
              <td>{dateLabel(row.date)}</td>
              <td>{row.topic || '—'}</td>
              <td>{row.score === null ? (row.status === 'missing' ? 'Not submitted' : 'Pending') : `${row.score}/${row.max_score}`}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    {plans.length > 0 && <section className="panel padded detail-records">
      <h2>Support History &amp; Action Plans</h2>
      {plans.map(plan => <p key={plan.id}>{plan.title} · {plan.status} · Review {dateLabel(plan.review_date)}</p>)}
    </section>}
  </>
}

function SupportGroup({ group, open }: { group: Group; open: () => void }) {
  return <div className="group-card">
    <div className="group-icon"><BookOpen size={20}/></div>
    <h3>{group.topic}</h3>
    <p>{group.members.length} students scored below 50% on this assessment topic.</p>
    <div className="group-meta">
      <div className="avatar-stack">
        {group.members.slice(0, 3).map((member, index) => <span key={member.id} className={'avatar avatar-' + index}>{initials(member.name)}</span>)}
      </div>
      <span>{group.members.length} students</span>
    </div>
    <button className="button group-button" onClick={open}>Review group <ArrowRight size={16}/></button>
  </div>
}

function Evaluation() {
  const [result, setResult] = useState<Eval>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true); setError('')
    try { setResult(await api<Eval>('/api/evaluation')) }
    catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }

  return <section className="panel padded">
    <div className="panel-heading flush">
      <div>
        <h2>Random Forest Model Evaluation &amp; Explainability</h2>
        <p>Evaluating the Random Forest predictive model against the baseline with a fixed faculty alert budget (10 alerts).</p>
      </div>
      <button className="button primary" disabled={busy} onClick={run}>
        <Activity size={17}/>{busy ? 'Running evaluation…' : 'Run Random Forest evaluation'}
      </button>
    </div>

    <div className="notice evaluation-note">
      <CircleAlert size={18}/>
      <span>
        <strong>Temporal Validation (No Data Leakage):</strong> Training strictly uses assessments dated prior to the target exam, and the entire latest cohort is held out.
      </span>
    </div>

    {error && <p role="alert" className="error">{error}</p>}

    {result && <>
      <p className="eval-meta">
        {result.train} earlier training histories · {result.test} held-out validation students · {result.positives} true struggling cases · {result.lead_days} days average advance warning lead time
      </p>

      {/* Benchmark Table */}
      <div className="table-scroll" style={{ marginBottom: '24px' }}>
        <table>
          <thead>
            <tr>
              <th>Model / Algorithm</th>
              <th>Flagged</th>
              <th>Caught (Recall)</th>
              <th>Missed</th>
              <th>Extra (False Alarms)</th>
              <th>Precision</th>
              <th>Recall</th>
              <th>F1 Score</th>
              <th>ROC-AUC</th>
              <th>Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {result.methods.map(method => <tr key={method.name}>
              <td style={{ fontWeight: 650 }}>{method.name}</td>
              <td>{method.flagged}</td>
              <td style={{ fontWeight: 700, color: '#097063' }}>{method.caught}</td>
              <td>{method.missed}</td>
              <td>{method.extra}</td>
              <td>{method.precision !== undefined ? `${method.precision}%` : '—'}</td>
              <td>{method.recall !== undefined ? `${method.recall}%` : '—'}</td>
              <td style={{ fontWeight: 700 }}>{method.f1 !== undefined ? `${method.f1}%` : '—'}</td>
              <td style={{ fontWeight: 700, color: '#086e63' }}>{method.roc_auc !== undefined ? `${method.roc_auc}%` : '—'}</td>
              <td>{method.accuracy !== undefined ? `${method.accuracy}%` : '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </div>

      {/* Feature Importance Section */}
      {result.feature_importances && <div style={{ borderTop: '1px solid var(--line)', paddingTop: '18px' }}>
        <h2>Random Forest Feature Importance &amp; Explainability</h2>
        <p style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '4px' }}>
          Breakdown of how much weight the Random Forest model assigns to each academic dimension.
        </p>
        <div className="feature-list">
          {result.feature_importances.map(item => <div key={item.key} className="feature-row">
            <span className="feature-label">{item.feature}</span>
            <div className="feature-track">
              <div className="feature-fill" style={{ width: `${item.importance}%` }}/>
            </div>
            <span className="feature-pct">{item.importance}%</span>
            <span className="feature-desc">{item.description}</span>
          </div>)}
        </div>
      </div>}
    </>}
  </section>
}

function App() {
  const [data, setData] = useState<Data>()
  const [page, setPage] = useState<Page>('Overview')
  const [subject, setSubject] = useState(sampleSubject)
  const [studentId, setStudentId] = useState('')
  const [dialog, setDialog] = useState<'import' | 'plan' | 'exam' | null>(null)
  const [draft, setDraft] = useState<Draft>()
  const [members, setMembers] = useState<string[]>([])
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [examDates, setExamDates] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('beforeexam-exams') || 'null') ?? { [sampleSubject]: '2026-11-21' } }
    catch { return { [sampleSubject]: '2026-11-21' } }
  })

  const refresh = async () => setData(await api<Data>('/api/dashboard'))
  useEffect(() => { refresh().catch(failure => setError(failure.message)) }, [])
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer) }, [toast])

  const subjects = [...new Set(data?.students.map(student => student.subject) ?? [sampleSubject])]
  const activeSubject = subjects.includes(subject) ? subject : subjects[0]
  const students = data?.students.filter(student => student.subject === activeSubject) ?? []
  const groups = data?.groups.filter(group => group.subject === activeSubject) ?? []
  const plans = data?.plans.filter(plan => plan.subject === activeSubject) ?? []
  const selected = students.find(student => student.id === studentId)
  const examDate = examDates[activeSubject]
  const subjectCutoff = students.flatMap(student => student.records.map(row => row.date)).sort().at(-1)
  const days = examDate && subjectCutoff ? Math.round((Date.parse(examDate) - Date.parse(subjectCutoff)) / 86400000) : null

  function navigate(destination: Page) { setPage(destination); setStudentId(''); setError(''); window.scrollTo(0, 0) }
  function openDialog(kind: typeof dialog) { setDialog(kind); setError('') }
  function openDraft(next: Draft) { setDraft(next); setMembers(next.candidates.map(item => item.id)); openDialog('plan') }

  async function runAction(action: () => Promise<string>) {
    setBusy(true); setError('')
    try { const message = await action(); await refresh(); setDialog(null); setToast(message) }
    catch (failure) { setError((failure as Error).message) }
    finally { setBusy(false) }
  }

  function importCsv(content: string) {
    return runAction(async () => {
      const result = await api<{ imported: number }>('/api/import', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: content })
      return `Imported ${result.imported} academic records.`
    })
  }

  function openStudent(student: Student) { navigate('Students'); setStudentId(student.id) }

  const heading = { Overview: 'Academic Overview', Students: 'Students', 'Support plans': 'Support Plans', 'Model evaluation': 'Model Evaluation' }[page]
  const description = {
    Overview: 'Proactive early-warning workspace: detect academic risk, simulate interventions, and support students before exams.',
    Students: 'Review machine learning failure probabilities, evidence signals, and personalized guidance.',
    'Support plans': 'Track support groups, baseline performance, and follow-up internal gains.',
    'Model evaluation': 'Benchmark the Random Forest model with temporal validation and feature explainability.'
  }[page]

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('Overview')}>
        <span className="logo"><Activity size={22}/></span>
        <span>Before<span>Exam</span><small>Faculty workspace</small></span>
      </button>
      <nav aria-label="Workspace">
        {nav.map(({ label, icon: Icon }) => <button
          key={label}
          onClick={() => navigate(label)}
          aria-label={label}
          aria-current={page === label ? 'page' : undefined}
          className={page === label ? 'nav-link active' : 'nav-link'}>
          <Icon size={18}/><span>{label}</span>
          {page === label && <span className="nav-dot"/>}
        </button>)}
      </nav>
      <div className="sidebar-footer">
        <span className="faculty-avatar"><GraduationCap size={19}/></span>
        <div>Faculty workspace<small>Srujan AI-03 Workspace</small></div>
      </div>
    </aside>

    <div className="main-area">
      <header className="topbar">
        <div className="breadcrumb">
          <LayoutDashboard size={16}/><span>Workspace</span><ChevronRight size={13}/><strong>{page}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <a className="button" href="/api/export" download="beforeexam-faculty-report.csv" title="Download CSV report of student watchlist and recommendations">
            <ArrowDownToLine size={15}/> Export Report (.CSV)
          </a>
          <span className="sample-label"><i/> Srujan AI-03</span>
        </div>
      </header>

      <main>
        {!selected && <div className="page-heading">
          <div>
            <h1>{heading}</h1>
            <p>{description}</p>
          </div>
          <div className="page-actions">
            <label className="subject-select">
              <BookOpen size={17}/>
              <select aria-label="Subject" value={activeSubject} onChange={event => { setSubject(event.target.value); setStudentId('') }}>
                {subjects.map(item => <option key={item} value={item}>{item === sampleSubject ? 'DBMS' : item}</option>)}
              </select>
              <ChevronDown size={14}/>
            </label>
            <button className="button primary" onClick={() => openDialog('import')}><FileUp size={17}/> Import records</button>
          </div>
        </div>}

        {!data && <section className="panel padded" role="status">
          {error || 'Loading classroom…'}
          {error && <button className="button" onClick={() => refresh().catch(failure => setError(failure.message))}>Retry</button>}
        </section>}

        {data && error && !dialog && <p className="error" role="alert">{error}</p>}

        {data && page === 'Overview' && <>
          <section className="hero">
            <div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><span className="orbit-dot"/>
            <div className="hero-content">
              <div className="hero-label"><CalendarDays size={15}/> Upcoming Assessment</div>
              <h2>{examDate ? 'Internal Assessment' : 'Set the Next Assessment'}</h2>
              <p>{activeSubject}{examDate ? ' · ' + dateLabel(examDate) : ''}</p>
              <button className="hero-button" onClick={() => openDialog('exam')}>Edit assessment date <ArrowUpRight size={15}/></button>
            </div>
            {days !== null && <div className="hero-count">
              <strong>{days > 0 ? days : days === 0 ? '0' : '✓'}</strong>
              <span>{days >= 0 ? 'days from latest record' : 'Assessment passed'}</span>
            </div>}
          </section>

          <div className="stats">
            <Stat icon={<Users size={19}/>} tone="mint" label="Students Monitored" value={students.length} note="In DBMS Cohort"/>
            <Stat icon={<CircleAlert size={19}/>} tone="rose" label="Priority Review" value={students.filter(s => s.priority === 'Priority review').length} note="Multiple warning signals"/>
            <Stat icon={<Sparkles size={19}/>} tone="amber" label="High AI Risk (>65%)" value={students.filter(s => (s.ml_risk ?? 0) >= 65).length} note="Flagged by ML model"/>
            <Stat icon={<ClipboardList size={19}/>} tone="blue" label="Active Support Plans" value={plans.filter(plan => plan.status !== 'Closed').length} note="Scheduled or monitoring"/>
          </div>

          {/* Visual Cohort Analytics */}
          <CohortAnalytics students={students}/>

          <div className="overview-grid">
            <div>
              <StudentTable key={activeSubject} students={students} select={openStudent} compact/>
              <button className="text-button all-students" onClick={() => navigate('Students')}>View full student directory <ArrowRight size={16}/></button>
            </div>
            <section className="panel groups">
              <div className="panel-heading">
                <div>
                  <h2>Suggested Support Groups</h2>
                  <p>Targeted cohort sessions based on shared quiz topic errors.</p>
                </div>
              </div>
              {groups.length ? groups.map(group => <SupportGroup
                key={group.assessment_id + group.topic}
                group={group}
                open={() => openDraft({ title: group.topic + ' revision session', subject: group.subject, candidates: group.members, assessment_id: group.assessment_id })}
              />) : <p className="empty">No shared assessment groups yet.</p>}
              {subjectCutoff && <p className="cutoff"><Database size={14}/> Records evaluated through {dateLabel(subjectCutoff)}</p>}
            </section>
          </div>
        </>}

        {data && page === 'Students' && (selected ? <StudentDetail
          student={selected}
          back={() => setStudentId('')}
          action={() => openDraft({ title: 'Academic check-in: ' + selected.name, subject: selected.subject, candidates: [selected] })}
          plans={plans.filter(plan => plan.members.includes(selected.id))}
        /> : <StudentTable key={activeSubject} students={students} select={openStudent}/>)}

        {data && page === 'Support plans' && <div className="plans-list">
          {plans.length ? plans.map(plan => <section className="panel padded" key={plan.id}>
            <div className="panel-heading flush">
              <div>
                <h2>{plan.title}</h2>
                <p>Scheduled review on {dateLabel(plan.review_date)} · {plan.members.length} students participating</p>
              </div>
              <select
                aria-label={'Status for ' + plan.title}
                className="status-select"
                value={plan.status}
                disabled={busy}
                onChange={event => {
                  const status = event.target.value
                  void runAction(async () => {
                    await api('/api/plans/' + plan.id, json('PATCH', { status }))
                    return 'Support plan status updated.'
                  })
                }}>
                {['Scheduled', 'Monitoring', 'Closed'].map(status => <option key={status}>{status}</option>)}
              </select>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Baseline Internal</th>
                    <th>Post-Intervention Internal</th>
                    <th>Net Score Change</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.members.map(id => {
                    const student = students.find(item => item.id === id)
                    const baseline = plan.baseline[id]
                    const followup = student?.records.filter(row => row.kind === 'internal' && row.status === 'graded' && row.date > baseline.cutoff).at(-1)
                    const latest = followup?.score != null ? Math.round(followup.score / followup.max_score * 1000) / 10 : null
                    const change = baseline.internal !== null && latest !== null ? Math.round((latest - baseline.internal) * 10) / 10 : null
                    return <tr key={id}>
                      <td style={{ fontWeight: 650 }}>{student?.name ?? id}</td>
                      <td>{percent(baseline.internal)}</td>
                      <td>{latest === null ? <span style={{ color: 'var(--muted)' }}>Awaiting results</span> : percent(latest)}</td>
                      <td style={{ fontWeight: 700, color: change === null ? 'inherit' : change > 0 ? '#097063' : change < 0 ? '#b71c1c' : 'inherit' }}>
                        {change === null ? '—' : `${change > 0 ? '+' : ''}${change} pp`}
                      </td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
          </section>) : <section className="panel padded empty-state">
            <ClipboardList size={32}/>
            <h2>No Support Plans Created Yet</h2>
            <p>Open a student profile or review suggested support groups to generate an academic intervention plan.</p>
            <button className="button primary" onClick={() => navigate('Overview')}>Go to Overview <ArrowRight size={16}/></button>
          </section>}
        </div>}

        {data && page === 'Model evaluation' && <Evaluation/>}
      </main>
    </div>

    {toast && <div role="status" className="toast"><Activity size={18}/>{toast}</div>}

    {dialog === 'import' && <Modal title="Import Academic Records" close={() => openDialog(null)}>
      <p>Upload a UTF-8 CSV containing attendance, internal marks, or assignment scores. Re-uploading matching assessments updates existing records.</p>
      <label className="upload-box">
        <FileUp size={28}/>
        <strong>Choose a CSV file</strong>
        <input type="file" accept=".csv,text/csv" disabled={busy} onChange={async event => {
          const file = event.target.files?.[0]
          if (!file) return
          try { await importCsv(await file.text()) }
          catch (failure) { setError((failure as Error).message) }
        }}/>
      </label>
      <div className="modal-actions">
        <a className="button" href="/samples/classroom.csv" download><ArrowDownToLine size={16}/> Sample classroom CSV</a>
        <button className="button" disabled={busy} onClick={async () => {
          try {
            const sample = await fetch('/samples/follow-up.csv')
            if (!sample.ok) throw new Error('Follow-up sample unavailable.')
            await importCsv(await sample.text())
          } catch (failure) { setError((failure as Error).message) }
        }}>Load sample follow-up</button>
      </div>
      {busy && <p role="status">Importing records…</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>}

    {dialog === 'exam' && <Modal title="Edit Assessment Date" close={() => openDialog(null)}>
      <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const values = new FormData(event.currentTarget)
        const next = { ...examDates, [activeSubject]: String(values.get('date')) }
        setExamDates(next)
        localStorage.setItem('beforeexam-exams', JSON.stringify(next))
        openDialog(null)
        setToast('Assessment date saved.')
      }}>
        <label className="field">Target assessment date<input type="date" name="date" defaultValue={examDate} required/></label>
        <button className="button primary" type="submit">Save Date</button>
      </form>
    </Modal>}

    {dialog === 'plan' && draft && <Modal title="Create Support Plan" close={() => openDialog(null)}>
      <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const values = new FormData(event.currentTarget)
        void runAction(async () => {
          await api('/api/plans', json('POST', {
            title: values.get('title'),
            review_date: values.get('date'),
            members,
            subject: draft.subject,
            assessment_id: draft.assessment_id,
          }))
          navigate('Support plans')
          return 'Support plan saved.'
        })
      }}>
        <label className="field">Support action title<input name="title" required maxLength={120} defaultValue={draft.title}/></label>
        <label className="field">Target review date<input type="date" name="date" required defaultValue={examDate}/></label>
        <fieldset className="members">
          <legend>Students Included ({members.length})</legend>
          {draft.candidates.map(member => <label key={member.id}>
            <input
              type="checkbox"
              checked={members.includes(member.id)}
              onChange={event => setMembers(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))}
            />
            <span>{member.name}</span>
            {member.score !== undefined && <small>{member.score}% on assessment</small>}
          </label>)}
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary" type="submit" disabled={!members.length || busy}>
          {busy ? 'Saving…' : 'Save Support Plan'}
        </button>
      </form>
    </Modal>}
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
