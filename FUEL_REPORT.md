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

For each month, `estimated liters = metered kWh × 0.643064`. Fuel price is an
editable `N$/liter` input on the report. `estimated cost = estimated liters ×
entered price`. Price is stored only in that browser's local storage, not in the
database or report API. Changing price recalculates all displayed months at the
new price; it does not retain historical pump prices, receipts, taxes, or other
operating costs. Leave price blank to show liters without cost.

Test with `PYTHONPATH=backend python -m pytest backend/tests/test_reports.py -q`,
the disposable PostgreSQL integration suite in `ALERTS.md`, the frontend
production build, and the two browser report tests in `playwright-tests/test_app.py`.
