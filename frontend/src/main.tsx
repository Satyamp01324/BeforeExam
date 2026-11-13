import { StrictMode, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BookOpen,
  CalendarDays, ChartNoAxesCombined, ChevronDown, ChevronRight, CircleAlert, ClipboardList,
  Database, FileUp, GraduationCap, LayoutDashboard, ListFilter, Search, SlidersHorizontal, Sparkles, Users, X,
} from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './styles.css'

type Priority = 'Priority review' | 'Watchlist' | 'Data pending' | 'On track'
type Entry = { kind: string; assessment_id: string; assessment_name: string; date: string; score: number | null; max_score: number; status: string; topic: string }
type Student = { id: string; name: string; subject: string; attendance: number | null; internal: number | null; average: number | null; trend: number | null; signals: string[]; priority: Priority; records: Entry[] }
type Group = { subject: string; assessment_id: string; topic: string; members: { id: string; name: string; score: number; assessment: string }[] }
type Plan = { id: string; title: string; subject: string; members: string[]; review_date: string; status: string; baseline: Record<string, { internal: number | null; cutoff: string }> }
type Data = { students: Student[]; groups: Group[]; plans: Plan[]; cutoff: string | null }
type Eval = { train: number; test: number; holdout: string; positives: number; lead_days: number; methods: { name: string; flagged: number; caught: number; missed: number; extra: number }[] }
type Draft = { title: string; subject: string; candidates: { id: string; name: string; score?: number }[]; assessment_id?: string }
type Page = 'Overview' | 'Students' | 'Support plans' | 'Model evaluation'
const nav = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Students', icon: Users },
  { label: 'Support plans', icon: ClipboardList }, { label: 'Model evaluation', icon: ChartNoAxesCombined },
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
function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} onCancel={close} className="modal" aria-labelledby="dialog-title">
    <div className="modal-head"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close"><X size={20}/></button></div>
    {children}
  </dialog>
}
function Stat({ icon, tone, label, value, note }: { icon: ReactNode; tone: string; label: string; value: number; note: string }) {
  return <div className="stat"><div className={'stat-icon ' + tone}>{icon}</div><div className="stat-label">{label}</div><strong>{value}</strong><small>{note}</small></div>
}
function StudentTable({ students, select, compact = false }: { students: Student[]; select: (student: Student) => void; compact?: boolean }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All statuses')
  const filtered = students.filter(student => (filter === 'All statuses' || filter === student.priority)
    && (student.name + ' ' + student.id).toLowerCase().includes(search.trim().toLowerCase()))
  return <section className="panel student-panel">
    <div className="panel-heading"><div><h2>{compact ? 'Student watchlist' : 'Student directory'}</h2><p>{compact ? 'Review the students who may need support.' : 'Search the class and open a student’s academic records.'}</p></div></div>
    <div className="table-tools"><label className="search"><Search size={16}/><input aria-label="Search students" placeholder="Search students..." value={search} onChange={event => setSearch(event.target.value)}/></label>
      <label className="filter"><ListFilter size={16}/><select aria-label="Filter students by priority" value={filter} onChange={event => setFilter(event.target.value)}>{['All statuses', ...priorities].map(value => <option key={value}>{value}</option>)}</select></label></div>
    <div className="table-scroll"><table><thead><tr><th>Student</th><th>Status</th><th>Attendance</th><th>Latest internal</th><th><span className="sr-only">Details</span></th></tr></thead>
      <tbody>{filtered.slice(0, compact && !search && filter === 'All statuses' ? 8 : undefined).map((student, index) => <tr key={student.id}>
        <td><button className="student-name" onClick={() => select(student)}><span className={'avatar avatar-' + index % 4}>{initials(student.name)}</span><span>{student.name}<small>{student.id}</small></span></button></td>
        <td><Badge value={student.priority}/></td><td>{percent(student.attendance)}</td><td>{percent(student.internal)}</td>
        <td><button className="icon-button row-arrow" onClick={() => select(student)} aria-label={'Open ' + student.name}><ChevronRight size={17}/></button></td>
      </tr>)}</tbody></table>{!filtered.length && <p className="empty">No students match these filters.</p>}</div>
  </section>
}
function StudentDetail({ student, back, action, plans }: { student: Student; back: () => void; action: () => void; plans: Plan[] }) {
  const [simulator, setSimulator] = useState(false)
  const attendanceNow = student.attendance ?? 0
  const internalNow = student.internal ?? 0
  const assignmentNow = student.average ?? 0
  const [attendanceTarget, setAttendanceTarget] = useState(Math.round(attendanceNow))
  const [internalTarget, setInternalTarget] = useState(Math.round(internalNow))
  const [assignmentTarget, setAssignmentTarget] = useState(Math.round(assignmentNow))
  const risk = (attendance: number, internal: number, assignment: number) => Math.round(Math.max(0, Math.min(100, (100 - attendance) * .35 + (100 - internal) * .35 + (100 - assignment) * .30)))
  const currentRisk = risk(attendanceNow, internalNow, assignmentNow)
  const projectedRisk = risk(attendanceTarget, internalTarget, assignmentTarget)
  const improvement = Math.max(0, currentRisk - projectedRisk)
  const nextAction = attendanceTarget - attendanceNow >= 8 ? 'Attendance recovery check-in' : internalTarget - internalNow >= 8 ? 'Internal-mark revision clinic' : 'Targeted assignment practice'
  const chart = student.records.filter(row => row.kind === 'assignment' && row.status === 'graded')
    .map(row => ({ name: row.assessment_name, score: Math.round((row.score ?? 0) / row.max_score * 100) }))
  return <>
    <button className="text-button back" onClick={back}><ArrowLeft size={16}/> Back to students</button>
    <div className="page-heading"><div><h1>{student.name}</h1><p>{student.id} · {student.subject}</p></div><div className="page-actions"><button className="button" onClick={() => setSimulator(value => !value)}><SlidersHorizontal size={17}/> {simulator ? 'Close simulator' : 'Simulate support impact'}</button><button className="button primary" onClick={action}><ClipboardList size={17}/> Plan support</button></div></div>
    {simulator && <section className="panel simulator"><div className="simulator-head"><div><span className="eyebrow"><Sparkles size={13}/> Non-destructive scenario</span><h2>See which intervention could move the needle</h2><p>Adjust a target, preview the expected risk change, then save a real support plan only when you are ready.</p></div><div className="sim-score"><strong>{projectedRisk}</strong><span>projected risk</span></div></div><div className="sim-grid"><div className="sim-controls"><label>Attendance target <output>{attendanceTarget}%</output><input type="range" min="40" max="100" value={attendanceTarget} onChange={event => setAttendanceTarget(Number(event.target.value))}/></label><label>Internal marks target <output>{internalTarget}%</output><input type="range" min="0" max="100" value={internalTarget} onChange={event => setInternalTarget(Number(event.target.value))}/></label><label>Assignment average target <output>{assignmentTarget}%</output><input type="range" min="0" max="100" value={assignmentTarget} onChange={event => setAssignmentTarget(Number(event.target.value))}/></label></div><div className="sim-result"><div className="risk-compare"><div><small>Current</small><strong>{currentRisk}</strong></div><span>→</span><div><small>Scenario</small><strong className={improvement >= 10 ? 'good' : ''}>{projectedRisk}</strong></div></div><p>{improvement ? <><b>{improvement} point improvement</b> if the targets are reached.</> : 'Try a realistic target to preview an improvement.'}</p><div className="next-action"><Sparkles size={16}/><span><b>Suggested next action</b>{nextAction}</span></div><button className="button primary" onClick={action}><ClipboardList size={16}/> Turn scenario into support plan</button></div></div></section>}
    <div className="detail-grid"><section className="panel padded"><div className="panel-heading flush"><div><h2>Assignment performance</h2><p>Scores normalized to a percentage.</p></div></div>
      {chart.length ? <div className="chart"><ResponsiveContainer width="100%" height={260}><LineChart data={chart} margin={{ top: 20, right: 20, bottom: 10, left: 0 }}>
        <CartesianGrid stroke="#e7edf1" vertical={false}/><XAxis dataKey="name" tick={{fontSize: 11}} tickLine={false}/><YAxis domain={[0,100]} width={36} tick={{fontSize: 11}} tickLine={false}/><Tooltip formatter={value => `${value}%`}/><Line type="linear" dataKey="score" name="Score" stroke="#098679" strokeWidth={3} dot={{r: 5}}/>
      </LineChart></ResponsiveContainer></div> : <p className="empty">No graded assignments yet.</p>}</section>
      <section className="panel padded evidence"><h2>Review evidence</h2><Badge value={student.priority}/><dl><div><dt>Attendance</dt><dd>{percent(student.attendance)}</dd></div><div><dt>Latest internal</dt><dd>{percent(student.internal)}</dd></div><div><dt>Recent assignment average</dt><dd>{percent(student.average)}</dd></div></dl>
        {student.signals.length ? <ul>{student.signals.map(signal => <li key={signal}>{signal}</li>)}</ul> : <p>No review signals in the available records.</p>}
      </section></div>
    <section className="panel detail-records"><div className="panel-heading"><div><h2>Academic records</h2><p>Dated records used to calculate the review signals.</p></div></div><div className="table-scroll"><table><thead><tr><th>Assessment</th><th>Date</th><th>Topic</th><th>Score</th></tr></thead><tbody>
      {[...student.records].reverse().map(row => <tr key={row.kind + row.assessment_id}><td>{row.assessment_name}</td><td>{dateLabel(row.date)}</td><td>{row.topic || '—'}</td><td>{row.score === null ? row.status === 'missing' ? 'Not submitted' : 'Pending' : `${row.score}/${row.max_score}`}</td></tr>)}
    </tbody></table></div></section>
    {plans.length > 0 && <section className="panel padded detail-records"><h2>Support history</h2>{plans.map(plan => <p key={plan.id}>{plan.title} · {plan.status} · Review {dateLabel(plan.review_date)}</p>)}</section>}
  </>
}
function SupportGroup({ group, open }: { group: Group; open: () => void }) {
  return <div className="group-card"><div className="group-icon"><BookOpen size={20}/></div><h3>{group.topic}</h3>
    <p>{group.members.length} students scored below 50% on the same assessment.</p>
    <div className="group-meta"><div className="avatar-stack">{group.members.slice(0, 3).map((member, index) => <span key={member.id} className={'avatar avatar-' + index}>{initials(member.name)}</span>)}</div><span>{group.members.length} students</span></div>
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
    <div className="panel-heading flush"><div><h2>Equal-budget model comparison</h2><p>Both methods can flag up to 10 students from the later cohort.</p></div><button className="button primary" disabled={busy} onClick={run}><Activity size={17}/>{busy ? 'Running…' : 'Run evaluation'}</button></div>
    <div className="notice evaluation-note"><CircleAlert size={18}/><span>This evaluation uses simulated data. The live watchlist uses transparent academic rules.</span></div>
    {error && <p role="alert" className="error">{error}</p>}
    {result && <><p className="eval-meta">{result.train} training records · {result.test} held-out records · {result.positives} below benchmark · {result.lead_days} days average lead time</p><div className="table-scroll"><table><thead><tr><th>Method</th><th>Flagged</th><th>Caught</th><th>Missed</th><th>Extra alerts</th></tr></thead><tbody>{result.methods.map(method => <tr key={method.name}><td>{method.name}</td><td>{method.flagged}</td><td>{method.caught}</td><td>{method.missed}</td><td>{method.extra}</td></tr>)}</tbody></table></div></>}
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
  const heading = { Overview: 'Academic overview', Students: 'Students', 'Support plans': 'Support plans', 'Model evaluation': 'Model evaluation' }[page]
  const description = { Overview: 'Identify academic risk and plan support before the next exam.', Students: 'Review academic signals and student-level evidence.', 'Support plans': 'Review interventions and follow-up assessment results.', 'Model evaluation': 'Compare an academic rule with a time-aware prediction model.' }[page]
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('Overview')}><span className="logo"><Activity size={22}/></span><span>Before<span>Exam</span><small>Faculty workspace</small></span></button>
      <nav aria-label="Workspace">{nav.map(({label, icon: Icon}) => <button key={label} onClick={() => navigate(label)} aria-label={label} aria-current={page === label ? 'page' : undefined} className={page === label ? 'nav-link active' : 'nav-link'}><Icon size={18}/><span>{label}</span>{page === label && <span className="nav-dot"/>}</button>)}</nav>
      <div className="sidebar-footer"><span className="faculty-avatar"><GraduationCap size={19}/></span><div>Faculty workspace<small>Demo environment</small></div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><div className="breadcrumb"><LayoutDashboard size={16}/><span>Workspace</span><ChevronRight size={13}/><strong>{page}</strong></div><span className="sample-label"><i/> Demo workspace</span></header>
      <main>
        {!selected && <div className="page-heading"><div><h1>{heading}</h1><p>{description}</p></div><div className="page-actions"><label className="subject-select"><BookOpen size={17}/><select aria-label="Subject" value={activeSubject} onChange={event => { setSubject(event.target.value); setStudentId('') }}>{subjects.map(item => <option key={item} value={item}>{item === sampleSubject ? 'DBMS' : item}</option>)}</select><ChevronDown size={14}/></label><button className="button primary" onClick={() => openDialog('import')}><FileUp size={17}/> Import records</button></div></div>}
        {!data && <section className="panel padded" role="status">{error || 'Loading classroom…'}{error && <button className="button" onClick={() => refresh().catch(failure => setError(failure.message))}>Retry</button>}</section>}
        {data && error && !dialog && <p className="error" role="alert">{error}</p>}
        {data && page === 'Overview' && <>
          <section className="hero">
            <div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit orbit-three"/><span className="orbit-dot"/>
            <div className="hero-content"><div className="hero-label"><CalendarDays size={15}/> Next assessment</div><h2>{examDate ? 'Internal assessment' : 'Set the next assessment'}</h2><p>{activeSubject}{examDate ? ' · ' + dateLabel(examDate) : ''}</p><button className="hero-button" onClick={() => openDialog('exam')}>Edit assessment date <ArrowUpRight size={15}/></button></div>
            {days !== null && <div className="hero-count"><strong>{days > 0 ? days : days === 0 ? '0' : '✓'}</strong><span>{days >= 0 ? 'days from latest record' : 'Assessment date passed'}</span></div>}
          </section>
          <div className="stats">
            <Stat icon={<Users size={19}/>} tone="mint" label="Students monitored" value={students.length} note="In the selected subject"/>
            <Stat icon={<CircleAlert size={19}/>} tone="rose" label="Priority review" value={students.filter(s => s.priority === 'Priority review').length} note="Multiple academic signals"/>
            <Stat icon={<BookOpen size={19}/>} tone="amber" label="Support groups" value={groups.length} note="Shared assessment evidence"/>
            <Stat icon={<ClipboardList size={19}/>} tone="blue" label="Active support plans" value={plans.filter(plan => plan.status !== 'Closed').length} note="Scheduled or monitoring"/>
          </div>
          <div className="overview-grid"><div><StudentTable key={activeSubject} students={students} select={openStudent} compact/><button className="text-button all-students" onClick={() => navigate('Students')}>View all students <ArrowRight size={16}/></button></div>
            <section className="panel groups"><div className="panel-heading"><div><h2>Suggested support</h2><p>Plan help for students with shared needs.</p></div></div>
              {groups.length ? groups.map(group => <SupportGroup key={group.assessment_id + group.topic} group={group} open={() => openDraft({ title: group.topic + ' revision session', subject: group.subject, candidates: group.members, assessment_id: group.assessment_id })}/>) : <p className="empty">No shared assessment groups yet.</p>}
              {subjectCutoff && <p className="cutoff"><Database size={14}/> Records through {dateLabel(subjectCutoff)}</p>}
            </section>
          </div>
        </>}
        {data && page === 'Students' && (selected ? <StudentDetail student={selected} back={() => setStudentId('')} action={() => openDraft({ title: 'Academic check-in', subject: selected.subject, candidates: [selected] })} plans={plans.filter(plan => plan.members.includes(selected.id))}/> : <StudentTable key={activeSubject} students={students} select={openStudent}/>)}
        {data && page === 'Support plans' && <div className="plans-list">{plans.length ? plans.map(plan => <section className="panel padded" key={plan.id}>
          <div className="panel-heading flush"><div><h2>{plan.title}</h2><p>Review on {dateLabel(plan.review_date)} · {plan.members.length} students</p></div>
            <select aria-label={'Status for ' + plan.title} className="status-select" value={plan.status} disabled={busy} onChange={event => { const status = event.target.value; void runAction(async () => { await api('/api/plans/' + plan.id, json('PATCH', { status })); return 'Support plan updated.' }) }}>{['Scheduled', 'Monitoring', 'Closed'].map(status => <option key={status}>{status}</option>)}</select></div>
          <div className="table-scroll"><table><thead><tr><th>Student</th><th>Previous internal</th><th>Latest follow-up</th><th>Change</th></tr></thead><tbody>{plan.members.map(id => {
            const student = students.find(item => item.id === id)
            const baseline = plan.baseline[id]
            const followup = student?.records.filter(row => row.kind === 'internal' && row.status === 'graded' && row.date > baseline.cutoff).at(-1)
            const latest = followup?.score != null ? Math.round(followup.score / followup.max_score * 1000) / 10 : null
            const change = baseline.internal !== null && latest !== null ? Math.round((latest - baseline.internal) * 10) / 10 : null
            return <tr key={id}><td>{student?.name ?? id}</td><td>{percent(baseline.internal)}</td><td>{latest === null ? 'Awaiting results' : percent(latest)}</td><td>{change === null ? '—' : `${change > 0 ? '+' : ''}${change} pp`}</td></tr>
          })}</tbody></table></div>
        </section>) : <section className="panel padded empty-state"><ClipboardList size={30}/><h2>No support plans yet</h2><p>Open a student or review a suggested group to create a plan.</p><button className="button primary" onClick={() => navigate('Overview')}>Go to overview <ArrowRight size={16}/></button></section>}</div>}
        {data && page === 'Model evaluation' && <Evaluation/>}
      </main>
    </div>
    {toast && <div role="status" className="toast"><Activity size={18}/>{toast}</div>}
    {dialog === 'import' && <Modal title="Import academic records" close={() => openDialog(null)}>
      <p>Upload a UTF-8 CSV with dated attendance, internal marks or assignment scores. Imports update matching assessment records.</p>
      <label className="upload-box"><FileUp size={28}/><strong>Choose a CSV file</strong><input type="file" accept=".csv,text/csv" disabled={busy} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { await importCsv(await file.text()) } catch (failure) { setError((failure as Error).message) } }}/></label>
      <div className="modal-actions"><a className="button" href="/samples/classroom.csv" download><ArrowDownToLine size={16}/> Sample classroom CSV</a><button className="button" disabled={busy} onClick={async () => { try { const sample = await fetch('/samples/follow-up.csv'); if (!sample.ok) throw new Error('Follow-up sample unavailable.'); await importCsv(await sample.text()) } catch (failure) { setError((failure as Error).message) } }}>Load sample follow-up</button></div>
      {busy && <p role="status">Importing records…</p>}{error && <p className="error" role="alert">{error}</p>}
    </Modal>}
    {dialog === 'exam' && <Modal title="Edit assessment date" close={() => openDialog(null)}><form onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault(); const values = new FormData(event.currentTarget); const next = { ...examDates, [activeSubject]: String(values.get('date')) }
      setExamDates(next); localStorage.setItem('beforeexam-exams', JSON.stringify(next)); openDialog(null); setToast('Assessment date saved.')
    }}><label className="field">Assessment date<input type="date" name="date" defaultValue={examDate} required/></label><button className="button primary" type="submit">Save date</button></form></Modal>}
    {dialog === 'plan' && draft && <Modal title="Create support plan" close={() => openDialog(null)}><form onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault(); const values = new FormData(event.currentTarget)
      void runAction(async () => {
        await api('/api/plans', json('POST', { title: values.get('title'), review_date: values.get('date'), members, subject: draft.subject, assessment_id: draft.assessment_id }))
        navigate('Support plans'); return 'Support plan saved.'
      })
    }}>
      <label className="field">Support action<input name="title" required maxLength={120} defaultValue={draft.title}/></label>
      <label className="field">Review date<input type="date" name="date" required defaultValue={examDate}/></label>
      <fieldset className="members"><legend>Students included</legend>{draft.candidates.map(member => <label key={member.id}><input type="checkbox" checked={members.includes(member.id)} onChange={event => setMembers(current => event.target.checked ? [...current, member.id] : current.filter(id => id !== member.id))}/><span>{member.name}</span>{member.score !== undefined && <small>{member.score}% on assessment</small>}</label>)}</fieldset>
      {error && <p className="error" role="alert">{error}</p>}<button className="button primary" type="submit" disabled={!members.length || busy}>{busy ? 'Saving…' : 'Save support plan'}</button>
    </form></Modal>}
  </div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>)
