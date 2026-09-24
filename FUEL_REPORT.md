# Generator fuel and monthly cost report

The operator measured **11.00 L** of fuel across the latest three distinct,
completed generator recordings on 24 September 2026. The corresponding stored
generator output is:

| Run start (UTC) | Metered output |
| --- | ---: |
| 2026-09-23 19:21:46 | 9.4564 kWh |
| 2026-09-24 08:21:59 | 1.6158 kWh |
| 2026-09-24 08:54:10 | 6.0334 kWh |
| **Total** | **17.1056 kWh** |

The fixed calibration factor is `11 / 17.1056 = 0.643064 L/kWh` (rounded to six
decimal places in the API). The three runs lasted about 5.40 hours in total,
equivalent to about 2.04 L/hour **for this sample only**. This is an estimate,
not a fuel sensor. Consumption per kWh can change with load, idle time, generator
condition, and fuel type. Recalibrate after another measured fuel period rather
than automatically shifting the original 11 L to newer runs.

The authenticated generator report returns `fuel_calibration` and `monthly`
buckets. Existing duplicate run rows are collapsed first. Each run belongs to
the month of its local start time; a run crossing midnight or a month boundary
is not split. Selected date ranges can therefore show partial months. Runs with
no power telemetry count as runs but have no estimated liters or cost.

For each month, `estimated liters = metered kWh × 0.643064`. Fuel prices are
stored in `generator_fuel_prices` as `N$/liter` with an effective timestamp.
The owner enters a local effective date in Reports; the browser sends midnight
with its timezone offset and the server stores the corresponding UTC instant.
The owner may save a new price, correct the amount at the same effective date,
or remove an erroneous entry. Viewers may read the history and costs but not
change it. The authenticated `PUT`/`DELETE /api/reports/fuel-prices` endpoints
require owner role and the request verification header.

Each metered run uses the latest price effective **at its start**. All energy
from a run crossing a price change retains its start price. The API returns
`fuel_prices` plus monthly `estimated_liters`, `estimated_cost`, `priced_runs`,
and `missing_price_runs`. Cost is unknown (`null`) for a month unless **every**
metered run in that month has a historical price; the UI shows missing coverage,
not a falsely complete total. Backdating or correcting a price recalculates
historical estimates. The old browser-only price key is not migrated because it
has no known effective date. These are estimated fuel costs, not receipts,
taxes, or actual expenditure. Price history changes never alter generator runs.

Test with `PYTHONPATH=backend python -m pytest backend/tests/test_reports.py -q`,
the disposable PostgreSQL integration suite in `ALERTS.md`, the frontend
production build, and the two browser report tests in `playwright-tests/test_app.py`.

## Night fuel planner

The Overview now has a read-only planner for a target time and battery SOC range
(defaults: 07:00, 25–30%). It uses the live SOC, the previous 36 hours of saved
summaries, and the fixed 11 L / 3-run calibration. Only low-solar intervals are
used: generator charging requires both recorded genset output and accepted AC
input above 100 W; off-generator discharge requires both inputs below 50 W.
Continuous sample pairs over 36 minutes apart are rejected. A result requires
at least 30 minutes of accepted generator data and 45 minutes of discharge data,
with recent examples of both. Missing, stale, implausible or unreachable data
shows a warning instead of a fuel number.

It estimates generator hours and fuel for the low/high target, then shows a
25% margin on the high-target fuel amount. The operator may enter *usable* fuel
already in the tank to see how much to add; this entry is not saved. The GX has
no fuel level measurement here, so the planner cannot verify tank contents or
capacity. It does not schedule/start the generator or send GX control commands.
The projected 15% crossing is a warning to start charging in time, not a
scheduled action. Fuel and SOC rates can change with load, solar, generator
acceptance and engine efficiency. Check the actual tank and AC input before
relying on the estimate.

Planner checks: `node --test frontend/src/fuelPlanner.test.js`,
`npm run build --prefix frontend`, and `playwright-tests/test_app.py` at mobile
and desktop widths against the local Vite dev server. The planner is hidden in
demo mode rather than presenting illustrative fuel advice.
