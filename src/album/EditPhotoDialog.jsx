import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { resolveCloudAssetUrl } from '../cloud'
import { todayInShanghai } from '../journal/journalModel'
import { prepareLifePhoto } from './lifeAlbumStore'

export default function EditPhotoDialog({ photo, onSave, onClose }) {
  const dialog = useRef(null)
  const lock = useRef(false)
  const [base, setBase] = useState(photo)
  const [current, setCurrent] = useState(null)
  const [fields, setFields] = useState({ owner: photo.owner, taken_on: photo.taken_on, caption: photo.caption || '' })
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editId = useRef(null)
  useEffect(() => {
    const element = dialog.current, focus = document.activeElement
    element.showModal()
    return () => { element.close(); focus?.focus?.({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  function changed() { editId.current = null; setError('') }
  function update(key, value) {
    changed()
    setFields(previous => ({ ...previous, [key]: value }))
  }
  async function submit(event) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    editId.current ||= crypto.randomUUID()
    try {
      const replacement = file ? await prepareLifePhoto(file, {}) : {}
      await onSave({ ...replacement, ...fields, id: photo.id, action: 'edit', base: base.edit_id || null, editId: editId.current })
      onClose()
    } catch (reason) {
      setCurrent(reason.current || null)
      setError(reason.message || '修改未保存，可以再试一次。')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return createPortal(<dialog className="life-edit-dialog" aria-labelledby="life-edit-title" ref={dialog}
    onCancel={event => { event.preventDefault(); if (!lock.current) onClose() }}>
    <form onSubmit={submit}>
      <h2 id="life-edit-title">编辑照片</h2>
      <fieldset disabled={busy} className="life-fields">
        <img src={preview || resolveCloudAssetUrl(base.thumb)} alt="照片预览" />
        <label className="life-replace-file">
          <span>替换照片</span>{file && <small>{file.name}</small>}
          <input type="file" aria-label="替换照片" accept="image/*" onChange={event => {
            const selected = event.target.files[0]
            if (selected) { changed(); setFile(selected) }
          }} />
        </label>
        <label>署名<select value={fields.owner} onChange={event => update('owner', event.target.value)}>
          <option value="orange">小琛</option><option value="pomelo">小琳</option>
        </select></label>
        <label>照片日期<input type="date" required value={fields.taken_on} max={todayInShanghai()} onChange={event => update('taken_on', event.target.value)} /></label>
        <label>配文<textarea rows={3} maxLength={2000} value={fields.caption} onChange={event => update('caption', event.target.value)} /></label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {current && <aside className="life-edit-conflict">
        <strong>另一台设备保存的版本</strong>
        <img src={resolveCloudAssetUrl(current.thumb)} alt="最新照片" />
        <p>{current.taken_on} · {current.owner === 'orange' ? '小琛' : '小琳'}</p>
        <p>{current.caption || '配文为空'}</p>
        <button type="button" onClick={() => {
          // Adopt remote changes for fields the user did not edit.
          setFields(previous => Object.fromEntries(Object.entries(previous)
            .map(([key, value]) => [key, value === base[key] ? current[key] : value])))
          setBase(current)
          setCurrent(null)
          changed()
        }}>保留我的修改，合并后核对</button>
      </aside>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button type="submit" disabled={busy || Boolean(current)}>{busy ? '正在保存…' : '保存修改'}</button>
      </footer>
    </form>
  </dialog>, document.body)
}
