// Share concurrent reads, show the last successful snapshot immediately, and
// prevent an older response from overwriting a local mutation.
export function createReadResource({ load, read = () => ({}), save = () => {} }) {
  let snapshot = read()
  let pending = null
  let revision = 0
  return {
    peek: () => snapshot,
    update(change) {
      revision += 1
      snapshot = change(snapshot)
      save(snapshot)
      return snapshot
    },
    refresh() {
      if (pending) return pending
      const started = revision
      pending = Promise.resolve().then(load).then(value => {
        if (revision === started) {
          snapshot = value
          save(snapshot)
        }
        return snapshot
      }).finally(() => { pending = null })
      return pending
    }
  }
}
