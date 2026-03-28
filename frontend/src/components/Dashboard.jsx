import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const METRIC_GROUPS = [
  {
    id: 'battery',
    title: 'Battery',
    metrics: [
      { key: 'battery_soc',     label: 'SOC (%)',     color: '#4ade80' },
      { key: 'battery_voltage', label: 'Voltage (V)', color: '#60a5fa' },
      { key: 'battery_current', label: 'Current (A)', color: '#f59e0b' },
    ],
  },
  {
    id: 'ac_in',
    title: 'AC Input',
    metrics: [
      { key: 'ac_in_power',      label: 'Power (W)',     color: '#f87171' },
      { key: 'ac_in_voltage',    label: 'Voltage (V)',   color: '#60a5fa' },
      { key: 'ac_in_current',    label: 'Current (A)',   color: '#f59e0b' },
      { key: 'ac_in_frequency',  label: 'Frequency (Hz)', color: '#a78bfa' },
    ],
  },
  {
    id: 'ac_out',
    title: 'AC Output',
    metrics: [
      { key: 'ac_out_power',     label: 'Power (W)',     color: '#f87171' },
      { key: 'ac_out_voltage',   label: 'Voltage (V)',   color: '#60a5fa' },
      { key: 'ac_out_current',   label: 'Current (A)',   color: '#f59e0b' },
      { key: 'ac_out_frequency', label: 'Frequency (Hz)', color: '#a78bfa' },
    ],
  },
]

const TIME_RANGES = [
  { label: '15m', seconds: 15 * 60 },
  { label: '1h',  seconds: 60 * 60 },
  { label: '6h',  seconds: 6 * 60 * 60 },
  { label: '24h', seconds: 24 * 60 * 60 },
  { label: '7d',  seconds: 7 * 24 * 60 * 60 },
]

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function SingleMetricChart({ metric, data }) {
  return (
    <div className="mb-3">
      <p className="text-xs text-gray-400 mb-1 ml-12">{metric.label}</p>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 2, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="recorded_at"
            tickFormatter={formatTime}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            minTickGap={60}
          />
          <YAxis
            domain={['auto', 'auto']}
            tick={{ fill: '#6b7280', fontSize: 10 }}
            width={48}
            tickFormatter={v => typeof v === 'number' ? v.toFixed(1) : v}
          />
          <Tooltip
            contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 6, fontSize: 12 }}
            labelFormatter={v => new Date(v).toLocaleString()}
          />
          <Line
            type="monotone"
            dataKey={metric.key}
            name={metric.label}
            stroke={metric.color}
            dot={false}
            strokeWidth={2}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function MetricChart({ group, data, activeMetrics }) {
  const visible = group.metrics.filter(m => activeMetrics.has(m.key))
  if (visible.length === 0) return null

  return (
    <div className="bg-gray-900 rounded-lg p-4 mb-4" data-testid={`chart-${group.id}`}>
      <h2 className="text-sm font-semibold text-gray-300 mb-4">{group.title}</h2>
      {visible.map(m => (
        <SingleMetricChart key={m.key} metric={m} data={data} />
      ))}
    </div>
  )
}

export default function Dashboard() {
  const allKeys = METRIC_GROUPS.flatMap(g => g.metrics.map(m => m.key))
  const [activeMetrics, setActiveMetrics] = useState(new Set(allKeys))
  const [timeRange, setTimeRange] = useState(3600)
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastFetched, setLastFetched] = useState(null)
  const [interval, setIntervalSec] = useState(60)
  const timerRef = useRef(null)

  const fetchData = useCallback(async () => {
    const from = new Date(Date.now() - timeRange * 1000).toISOString()
    const url = `/api/readings?from=${encodeURIComponent(from)}&limit=2000`
    try {
      const res = await fetch(url)
      const json = await res.json()
      setData(json)
      setLastFetched(new Date())
    } catch (e) {
      console.error('Fetch error', e)
    } finally {
      setLoading(false)
    }
  }, [timeRange])

  // Load current interval from settings
  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(d => setIntervalSec(d.interval_seconds))
      .catch(() => {})
  }, [])

  // Fetch data + schedule auto-refresh
  useEffect(() => {
    fetchData()
    const refreshMs = interval <= 60 ? 5000 : 30000
    timerRef.current = setInterval(fetchData, refreshMs)
    return () => clearInterval(timerRef.current)
  }, [fetchData, interval])

  const toggleMetric = key => {
    setActiveMetrics(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const toggleGroup = group => {
    const keys = group.metrics.map(m => m.key)
    const allOn = keys.every(k => activeMetrics.has(k))
    setActiveMetrics(prev => {
      const next = new Set(prev)
      keys.forEach(k => (allOn ? next.delete(k) : next.add(k)))
      return next
    })
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        {/* Time range */}
        <div className="flex gap-1" data-testid="time-range-selector">
          {TIME_RANGES.map(r => (
            <button
              key={r.label}
              data-testid={`range-${r.label}`}
              onClick={() => setTimeRange(r.seconds)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                timeRange === r.seconds
                  ? 'bg-green-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="ml-auto text-xs text-gray-500">
          {loading
            ? 'Loading…'
            : lastFetched
            ? `Updated ${lastFetched.toLocaleTimeString()} · auto-refresh ${interval <= 60 ? '5s' : '30s'}`
            : ''}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Sidebar: metric toggles */}
        <aside className="w-48 shrink-0">
          {METRIC_GROUPS.map(group => (
            <div key={group.id} className="mb-4">
              <button
                data-testid={`group-toggle-${group.id}`}
                onClick={() => toggleGroup(group)}
                className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 hover:text-white transition-colors"
              >
                {group.title}
              </button>
              <div className="space-y-1">
                {group.metrics.map(m => (
                  <label
                    key={m.key}
                    data-testid={`metric-toggle-${m.key}`}
                    className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white"
                  >
                    <input
                      type="checkbox"
                      checked={activeMetrics.has(m.key)}
                      onChange={() => toggleMetric(m.key)}
                      className="accent-green-500"
                    />
                    <span
                      className="w-2 h-2 rounded-full inline-block shrink-0"
                      style={{ background: m.color }}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* Charts */}
        <div className="flex-1 min-w-0">
          {data.length === 0 && !loading && (
            <div className="bg-gray-900 rounded-lg p-8 text-center text-gray-500">
              No data yet. Recordings will appear here once the collector runs.
            </div>
          )}
          {METRIC_GROUPS.map(group => (
            <MetricChart
              key={group.id}
              group={group}
              data={data}
              activeMetrics={activeMetrics}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
