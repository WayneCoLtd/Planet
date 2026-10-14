import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cloudEnabled } from '../cloud'
import { prepareLifePhoto } from '../album/lifeAlbumStore'
import {
  DEFAULT_GOAL,
  JOURNAL_FIRST_DATE,
  OWNER_NAMES,
  OWNERS,
  emptyEntry,
  entryNotes,
  mergeEntryMedia,
  normalizeEntry,
  normalizeGoal,
  shiftDate,
  todayInShanghai,
  weekStart,
  weekSummary,
} from './journalModel'
import {
  entryKey,
  imageUrl,
  journalStore,
  rememberDraft,
  loadWeek,
  saveEntry,
  saveGoal,
} from './journalStore'
import './growthJournal.css'
import JournalNotes from './JournalNotes'

function ScreenshotViewer({ entry, close }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current,
      focus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      focus?.focus?.()
    }
  }, [])
  return createPortal(
    <dialog
      ref={ref}
      className="journal-image-dialog"
      onCancel={close}
      onClick={(event) => {
        if (event.target === ref.current) close()
      }}
    >
      <header>
        <span>
          {entry.date} · {OWNER_NAMES[entry.owner]}的睡眠截图
        </span>
        <button onClick={close} aria-label="关闭睡眠截图">
          关闭 ×
        </button>
      </header>
      <img src={imageUrl(entry)} alt="睡眠截图完整预览" />
    </dialog>,
    document.body,
  )
}

function JournalPage({
  owner,
  date,
  entries,
  goals,
  onSaved,
  onGoalSaved,
  connected,
  active,
  onRefresh,
}) {
  const key = entryKey(owner, date)
  const remote =
    entries.find((item) => item.owner === owner && item.date === date) ||
    emptyEntry(owner, date)
  const remoteRef = useRef(remote)
  remoteRef.current = remote
  const [entry, setEntry] = useState(remote)
  const currentRef = useRef(remote)
  const [ready, setReady] = useState(false)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [note, setNote] = useState('')
  const [conflict, setConflict] = useState(null)
  const [viewImage, setViewImage] = useState(false)
  const [sleepEditing, setSleepEditing] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const [draftFailure, setDraftFailure] = useState(false)
  const draftWrites = useRef(Promise.resolve())
  const start = weekStart(date)
  const goalRow = goals
    .filter((item) => item.owner === owner && item.week_start <= start)
    .sort((a, b) => b.week_start.localeCompare(a.week_start))[0]
  const goal = goalRow
    ? { nights: goalRow.nights, before: goalRow.before_time }
    : DEFAULT_GOAL
  const summary = weekSummary(entries, owner, start, goal)
  const currentWeek = weekStart(todayInShanghai())
  const currentGoal = goals.find(
    (item) => item.owner === owner && item.week_start === currentWeek,
  )
  const [goalForm, setGoalForm] = useState({
    nights: currentGoal?.nights || goal.nights,
    before: currentGoal?.before_time || goal.before,
  })
  const goalDetails = useRef(null)

  useEffect(() => {
    let alive = true
    journalStore('drafts', 'get', key)
      .then((draft) => {
        if (!alive) return
        if (draft) {
          currentRef.current = mergeEntryMedia(draft.entry, remoteRef.current)
          dirtyRef.current = true
          setEntry(currentRef.current)
          setDirty(true)
          setNote('已恢复本机草稿')
        }
        setReady(true)
      })
      .catch(() => {
        if (alive) {
          setReady(true)
          setDraftFailure(true)
          setNote('本机草稿无法保存，离开前请保存记录')
        }
      })
    return () => {
      alive = false
    }
  }, [key])
  useEffect(() => {
    if (!lock.current) {
      currentRef.current = dirtyRef.current
        ? mergeEntryMedia(currentRef.current, remote)
        : remote
      setEntry(currentRef.current)
      setImageFailed(false)
    }
  }, [
    remote.version,
    remote.screenshotUrl,
    JSON.stringify(
      entryNotes(remote).flatMap((note) =>
        note.images.map((image) => [image.url, image.thumbUrl]),
      ),
    ),
  ])
  useEffect(() => {
    const warn = (event) => {
      if (lock.current || (dirtyRef.current && draftFailure)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [draftFailure])

  function change(patch) {
    const next = { ...currentRef.current, ...patch }
    currentRef.current = next
    dirtyRef.current = true
    setEntry(next)
    setDirty(true)
    rememberDraft(key, next)
    setNote('正在保存草稿…')
    draftWrites.current = draftWrites.current
      .catch(() => {})
      .then(() => journalStore('drafts', 'put', { key, entry: next }))
    draftWrites.current
      .then(() => {
        setDraftFailure(false)
        setNote('草稿已存本机')
      })
      .catch(() => {
        setDraftFailure(true)
        setNote('本机空间不足，请保存记录后再离开')
      })
  }
  async function chooseImage(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || lock.current) return
    lock.current = true
    setBusy(true)
    setNote('正在整理截图…')
    try {
      const prepared = await prepareLifePhoto(file, {})
      change({
        pendingImage: { id: prepared.id, data: prepared.image },
        screenshotPath: '',
        screenshotUrl: '',
      })
      setImageFailed(false)
    } catch (error) {
      setNote(`截图未保存：${error.message}`)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function chooseNoteImages(id, files) {
    if (!files.length || lock.current) return
    lock.current = true
    setBusy(true)
    let done = 0
    try {
      for (const file of files) {
        setNote(`正在整理附图 ${done + 1}/${files.length}…`)
        const prepared = await prepareLifePhoto(file, {})
        const notes = entryNotes(currentRef.current).map((note) =>
          note.id === id
            ? {
                ...note,
                images: [
                  ...note.images,
                  {
                    id: prepared.id,
                    path: '',
                    thumbPath: '',
                    pendingImage: {
                      data: prepared.image,
                      thumbnail: prepared.thumbnail,
                    },
                  },
                ],
              }
            : note,
        )
        change({ notes })
        done++
      }
      setNote(`${done} 张附图已加入草稿`)
    } catch (error) {
      setNote(`已保留 ${done} 张，${error.message}`)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function save(checkIn = false) {
    if (lock.current || !ready) return
    lock.current = true
    setBusy(true)
    setNote('正在保存…')
    try {
      await draftWrites.current.catch(() => {})
      const normalized = normalizeEntry(currentRef.current)
      const result = await saveEntry({
        ...normalized,
        notes: entryNotes(currentRef.current),
        screenshotUrl: currentRef.current.screenshotUrl,
        pendingImage: currentRef.current.pendingImage,
        checkedIn: checkIn || normalized.checkedIn,
      })
      currentRef.current = result
      dirtyRef.current = false
      setEntry(result)
      setDirty(false)
      setConflict(null)
      onSaved(result)
      try {
        await journalStore('drafts', 'delete', key)
      } catch {
        setDraftFailure(true)
      }
      setNote(cloudEnabled ? '已同步' : '已保存到此浏览器')
    } catch (error) {
      setNote(error.message || '未同步，请稍后重试')
      if (error.status === 409 && error.current) setConflict(error.current)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function updateGoal() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const checked = normalizeGoal(goalForm)
      const result = await saveGoal({
        ...checked,
        owner,
        week_start: currentWeek,
        version: currentGoal?.version || 0,
      })
      onGoalSaved(result)
      setNote('本周目标已更新')
      goalDetails.current.open = false
    } catch (error) {
      setNote(error.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const screenshot = imageUrl(entry)
  const disabled = busy || !ready
  return (
    <article
      className={`journal-page is-${owner} ${active ? 'is-mobile-active' : ''}`}
      aria-label={`${OWNER_NAMES[owner]}的书页`}
    >
      <header className="journal-page-heading">
        <div>
          <span className="journal-initial" aria-hidden="true">
            {owner === 'orange' ? 'C' : 'L'}
          </span>
          <h3>{OWNER_NAMES[owner]}</h3>
        </div>
        <span className="journal-sign-state">
          {entry.checkedIn ? '已签到' : '未签到'}
        </span>
      </header>
      <section className="journal-sleep compact-sleep">
        <div className="journal-sleep-heading">
          <h4>昨夜睡眠</h4>{' '}
          {start === weekStart(todayInShanghai()) && (
            <details
              ref={goalDetails}
              className="journal-goal"
              onToggle={(event) => {
                if (event.currentTarget.open)
                  setGoalForm({
                    nights: currentGoal?.nights || goal.nights,
                    before: currentGoal?.before_time || goal.before,
                  })
              }}
            >
              <summary>
                本周 {summary.reached}/{goal.nights} 晚 · 目标
              </summary>
              <div>
                <strong>本周睡眠目标</strong>
                <label>
                  每周
                  <select
                    aria-label={`${OWNER_NAMES[owner]}每周目标晚数`}
                    value={goalForm.nights}
                    disabled={busy}
                    onChange={(event) =>
                      setGoalForm({
                        ...goalForm,
                        nights: Number(event.target.value),
                      })
                    }
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <option key={n} value={n}>
                        {n} 晚
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  此时间前入睡
                  <input
                    type="time"
                    aria-label={`${OWNER_NAMES[owner]}目标入睡时间`}
                    value={goalForm.before}
                    disabled={busy}
                    onChange={(event) =>
                      setGoalForm({ ...goalForm, before: event.target.value })
                    }
                  />
                </label>
                <small>
                  {currentWeek} — {shiftDate(currentWeek, 6)}
                </small>
                <div
                  className="journal-week-dots"
                  aria-label={`本周已达标 ${summary.reached} 晚`}
                >
                  {summary.days.map((day, index) => (
                    <span
                      key={day.date}
                      className={day.reached === true ? 'is-reached' : ''}
                      title={`${day.date}：${day.reached === null ? '未记录' : day.reached ? '已达标' : '未达标'}`}
                    >
                      {'一二三四五六日'[index]}
                    </span>
                  ))}
                </div>
                <button disabled={busy || !connected} onClick={updateGoal}>
                  保存目标
                </button>
              </div>
            </details>
          )}
        </div>
        <div className="journal-sleep-line">
          <div className="journal-sleep-value">
            {entry.sleepTime ? (
              <>
                <strong>{entry.sleepTime}</strong>
                <small>
                  {(entry.sleepPreviousDay ? shiftDate(date, -1) : date)
                    .slice(5)
                    .replace('-', '/')}{' '}
                  入睡
                </small>
              </>
            ) : (
              <span>未记录</span>
            )}
            <button
              disabled={disabled}
              onClick={() => setSleepEditing((value) => !value)}
            >
              {sleepEditing ? '收起' : entry.sleepTime ? '修改' : '填写'}
            </button>
          </div>
          <div className="journal-screenshot">
            {screenshot && !imageFailed && (
              <button
                className="journal-screenshot-preview"
                onClick={() => setViewImage(true)}
                aria-label={`查看${OWNER_NAMES[owner]}睡眠截图`}
              >
                <img
                  src={screenshot}
                  alt="睡眠截图缩略图"
                  onError={() => setImageFailed(true)}
                />
              </button>
            )}
            <label className="journal-upload">
              {screenshot ? '换截图' : '＋ 截图'}
              <input
                type="file"
                accept="image/*"
                disabled={disabled}
                aria-label={`${OWNER_NAMES[owner]}上传睡眠截图`}
                onChange={chooseImage}
              />
            </label>
          </div>
        </div>
        {sleepEditing && (
          <div className="journal-sleep-edit">
            <label>
              入睡时间
              <input
                id={`sleep-${owner}`}
                type="time"
                value={entry.sleepTime}
                disabled={disabled}
                onChange={(event) =>
                  change({
                    sleepTime: event.target.value,
                    sleepPreviousDay:
                      Number(event.target.value.slice(0, 2)) >= 12,
                  })
                }
              />
            </label>
            <select
              aria-label={`${OWNER_NAMES[owner]}入睡所属日期`}
              value={entry.sleepPreviousDay ? 'previous' : 'same'}
              disabled={disabled}
              onChange={(event) =>
                change({ sleepPreviousDay: event.target.value === 'previous' })
              }
            >
              <option value="previous">
                {shiftDate(date, -1).slice(5)} 入睡
              </option>
              <option value="same">{date.slice(5)} 入睡</option>
            </select>
            {screenshot && (
              <button
                disabled={disabled}
                onClick={() =>
                  change({
                    screenshotPath: '',
                    screenshotUrl: '',
                    pendingImage: undefined,
                  })
                }
              >
                移除截图
              </button>
            )}
            <button disabled={disabled} onClick={() => setSleepEditing(false)}>
              完成
            </button>
          </div>
        )}
      </section>
      <section className="journal-study">
        <div className="journal-study-heading">
          <h4>今日手记</h4>
          <label>
            自习{' '}
            <span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max="24"
                step="0.25"
                aria-label={`${OWNER_NAMES[owner]}自习时长（小时）`}
                placeholder="—"
                value={
                  entry.studyMinutes === null
                    ? ''
                    : Number((entry.studyMinutes / 60).toFixed(2))
                }
                disabled={disabled}
                onChange={(event) =>
                  change({
                    studyMinutes:
                      event.target.value === ''
                        ? null
                        : Math.round(Number(event.target.value) * 60),
                  })
                }
              />{' '}
              小时
            </span>
          </label>
        </div>
        <JournalNotes
          owner={owner}
          notes={entryNotes(entry)}
          disabled={disabled}
          onChange={(notes) => change({ notes })}
          onImages={chooseNoteImages}
          onRefresh={onRefresh}
        />
      </section>
      <section className="journal-growth">
        <label htmlFor={`growth-${owner}`}>今天的一点进步</label>
        <textarea
          id={`growth-${owner}`}
          aria-label={`${OWNER_NAMES[owner]}今天的一点进步`}
          rows={2}
          maxLength={500}
          value={entry.growthNote || ''}
          disabled={disabled}
          placeholder="生活、学习、想法，都可以。"
          onChange={(event) => change({ growthNote: event.target.value })}
        />
      </section>
      {conflict && (
        <aside className="journal-conflict" role="alert">
          <strong>另一台设备有新记录</strong>
          <p>
            云端：{conflict.sleepTime || '未填睡眠'} · 自习{' '}
            {conflict.studyMinutes == null
              ? '未填'
              : `${conflict.studyMinutes} 分钟`}
          </p>
          <p>
            {entryNotes(conflict)
              .map(
                (note) =>
                  `${note.text}${note.images.length ? `（${note.images.length} 张附图）` : ''}`,
              )
              .join('\n') || '未填写手记'}
          </p>
          {conflict.growthNote && <p>进步记录：{conflict.growthNote}</p>}
          <p>本机草稿仍在上方。对照后选择：</p>
          <button
            disabled={busy}
            onClick={() => {
              change({ ...conflict, pendingImage: undefined })
              setConflict(null)
              onSaved(conflict)
            }}
          >
            载入云端版本
          </button>
          <button
            disabled={busy}
            onClick={() => {
              change({ version: conflict.version })
              setConflict(null)
              setNote('已保留本机内容，请核对后再次保存')
            }}
          >
            保留本机内容，重新保存
          </button>
        </aside>
      )}
      <footer className="journal-page-footer">
        <span role="status">{note || '内容均可选填'}</span>
        <div>
          <button
            disabled={disabled || !connected || !dirty}
            onClick={() => save(false)}
          >
            保存
          </button>
          <button
            className="journal-checkin"
            disabled={disabled || !connected || entry.checkedIn}
            onClick={() => save(true)}
          >
            {entry.checkedIn
              ? '已签到 ✓'
              : date < todayInShanghai()
                ? '补卡'
                : '签到'}
          </button>
        </div>
      </footer>
      <span className="journal-folio" aria-hidden="true">
        {date.replaceAll('-', '.')}
      </span>
      {viewImage && (
        <ScreenshotViewer entry={entry} close={() => setViewImage(false)} />
      )}
    </article>
  )
}

export default function GrowthJournal() {
  const [date, setDate] = useState(todayInShanghai)
  const [owner, setOwner] = useState('pomelo')
  const [entries, setEntries] = useState([])
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(!cloudEnabled)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [turn, setTurn] = useState(null)
  const timer = useRef(null)
  const commitTimer = useRef(null)
  const [turnDate, setTurnDate] = useState(date)
  const book = useRef(null)
  useEffect(() => {
    let alive = true
    setLoading(true)
    setError('')
    setConnected(false)
    loadWeek(date)
      .then((result) => {
        if (alive) {
          setEntries(result.entries)
          setGoals(result.goals)
          setConnected(true)
        }
      })
      .catch((reason) => {
        if (alive) setError(reason.message || '记录读取失败，请重试')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [weekStart(date), retry])
  useEffect(() => {
    const refresh = () => setRetry((value) => value + 1)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      clearTimeout(timer.current)
      clearTimeout(commitTimer.current)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [])
  function navigate(next) {
    if (
      next < JOURNAL_FIRST_DATE ||
      next > todayInShanghai() ||
      next === date ||
      turn
    )
      return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDate(next)
      return
    }
    const direction = next > date ? 'next' : 'previous'
    setTurnDate(date)
    setTurn(direction)
    commitTimer.current = setTimeout(() => setDate(next), 260)
    timer.current = setTimeout(() => setTurn(null), 520)
  }
  function onKeyDown(event) {
    if (
      event.target.closest('input, textarea, select, button, summary') ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      navigate(shiftDate(date, event.key === 'ArrowLeft' ? -1 : 1))
    }
  }
  const mergeEntry = (result) =>
    setEntries((previous) => [
      ...previous.filter(
        (row) => row.owner !== result.owner || row.date !== result.date,
      ),
      result,
    ])
  const mergeGoal = (result) =>
    setGoals((previous) => [
      ...previous.filter(
        (row) =>
          row.owner !== result.owner || row.week_start !== result.week_start,
      ),
      result,
    ])
  return (
    <section className="journal-shell" aria-label="每日签到簿">
      <header className="journal-heading">
        <span>DAILY JOURNAL</span>
        <h2>日有所进</h2>
      </header>
      <div className="journal-toolbar">
        <button
          aria-label="前一天"
          disabled={date <= JOURNAL_FIRST_DATE || Boolean(turn)}
          onClick={() => navigate(shiftDate(date, -1))}
        >
          ‹
        </button>
        <label>
          <span>记录日期</span>
          <input
            type="date"
            aria-label="记录日期，可选择过去日期补卡"
            min={JOURNAL_FIRST_DATE}
            max={todayInShanghai()}
            value={date}
            disabled={Boolean(turn)}
            onChange={(event) => {
              if (event.target.value) navigate(event.target.value)
            }}
          />
        </label>
        <button
          aria-label="后一天"
          disabled={date >= todayInShanghai() || Boolean(turn)}
          onClick={() => navigate(shiftDate(date, 1))}
        >
          ›
        </button>
        <button
          className="journal-today"
          disabled={date === todayInShanghai() || Boolean(turn)}
          onClick={() => navigate(todayInShanghai())}
        >
          今天
        </button>
      </div>
      <div className="journal-owner-switch" role="group" aria-label="切换书页">
        {OWNERS.map((id) => (
          <button
            key={id}
            aria-pressed={owner === id}
            onClick={() => setOwner(id)}
          >
            {OWNER_NAMES[id]}
          </button>
        ))}
      </div>
      <div className="journal-sync-status" role="status">
        {loading ? (
          '正在读取记录…'
        ) : error ? (
          <>
            {error} <button onClick={() => setRetry((n) => n + 1)}>重试</button>
          </>
        ) : null}
      </div>
      <div
        ref={book}
        className={`journal-book ${turn ? `is-turning turn-${turn}` : ''}`}
        tabIndex={0}
        aria-label="签到书，左右方向键翻页"
        onKeyDown={onKeyDown}
      >
        <div className="journal-spread" inert={turn ? '' : undefined}>
          {OWNERS.map((id) => (
            <JournalPage
              key={`${date}-${id}`}
              owner={id}
              date={date}
              entries={entries}
              goals={goals}
              onSaved={mergeEntry}
              onGoalSaved={mergeGoal}
              connected={connected}
              active={owner === id}
              onRefresh={() => setRetry((value) => value + 1)}
            />
          ))}
        </div>
        {turn && (
          <div className="journal-turn-leaf" aria-hidden="true">
            <span>{turnDate.replaceAll('-', '.')}</span>
          </div>
        )}
      </div>
    </section>
  )
}
