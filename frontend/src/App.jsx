import React from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import Dashboard from './components/Dashboard'
import Settings from './components/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-950 text-gray-100">
        <header className="bg-gray-900 border-b border-gray-800 px-3 py-2 sm:px-6 sm:py-3 flex items-center gap-4 sm:gap-8">
          <span className="font-bold text-lg text-green-400">⚡ Venus OS</span>
          <nav className="flex gap-4">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `px-3 py-1 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-green-700 text-white'
                    : 'text-gray-400 hover:text-white'
                }`
              }
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `px-3 py-1 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-green-700 text-white'
                    : 'text-gray-400 hover:text-white'
                }`
              }
            >
              Settings
            </NavLink>
          </nav>
        </header>

        <main className="p-3 sm:p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
