import React, { useEffect, useState } from 'react'

const INTERVALS = [
  { value: 1,    label: '1 second' },
  { value: 5,    label: '5 seconds' },
  { value: 10,   label: '10 seconds' },
  { value: 20,   label: '20 seconds' },
  { value: 30,   label: '30 seconds' },
  { value: 60,   label: '1 minute' },
  { value: 600,  label: '10 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
]

export default function Settings() {
  const [selected, setSelected] = useState(60)
  const [saved, setSaved] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => {
        setSelected(d.interval_seconds)
        setSaved(d.interval_seconds)
      })
      .finally(() => setLoading(false))
  }, [])

  const save = async () => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval_seconds: selected }),
    })
    if (res.ok) {
      setSaved(selected)
      setToast('Saved!')
      setTimeout(() => setToast(null), 2500)
    } else {
      setToast('Error saving settings')
      setTimeout(() => setToast(null), 3000)
    }
  }

  if (loading) return <p className="text-gray-400">Loading…</p>

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-semibold mb-6">Recording Settings</h1>

      <label className="block mb-2 text-sm text-gray-400">Recording interval</label>
      <select
        data-testid="interval-select"
        value={selected}
        onChange={e => setSelected(Number(e.target.value))}
        className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white mb-6 focus:outline-none focus:border-green-500"
      >
        {INTERVALS.map(i => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
      </select>

      <button
        data-testid="save-btn"
        onClick={save}
        disabled={selected === saved}
        className="px-6 py-2 rounded bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors"
      >
        Save
      </button>

      {toast && (
        <div
          data-testid="toast"
          className={`mt-4 px-4 py-2 rounded text-sm ${
            toast.startsWith('Error') ? 'bg-red-800' : 'bg-green-800'
          }`}
        >
          {toast}
        </div>
      )}

      <p className="mt-6 text-xs text-gray-500">
        Current saved interval:{' '}
        <span className="text-green-400">
          {INTERVALS.find(i => i.value === saved)?.label ?? `${saved}s`}
        </span>
      </p>
    </div>
  )
}
