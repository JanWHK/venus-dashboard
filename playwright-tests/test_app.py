"""Helio browser regression tests. Default tests use only the explicit demo."""
import os
import re

import pytest
from playwright.sync_api import Page, expect

BASE = os.getenv("HELIO_BASE_URL", "http://localhost:8081")


def open_demo(page: Page):
    page.goto(BASE)
    page.get_by_role("button", name="Explore the demo").click()
    expect(page.get_by_role("heading", name="Hello, brighter day.")).to_be_visible()


def test_login_guards_workspace(page: Page):
    page.goto(f"{BASE}/devices")
    expect(page.get_by_label("Username", exact=True)).to_be_visible()
    assert page.request.get(f"{BASE}/api/live").status == 401


def test_demo_has_explicit_sample_label_and_energy_flow(page: Page):
    open_demo(page)
    expect(page.locator(".demo-banner")).to_contain_text("Illustrative data")
    expect(page.get_by_role("heading", name="Your energy, in motion.")).to_be_visible()
    expect(page.get_by_role("heading", name="Solar input.")).to_be_visible()
    expect(page.get_by_role("heading", name="Generator input.")).to_be_visible()
    expect(page.locator(".grid-card")).to_contain_text("AC input")
    expect(page.locator(".grid-card .metric-value")).to_contain_text("2.56")
    mix = page.locator(".system-use-panel")
    expect(mix).to_contain_text("DC (GX)")
    assert mix.locator(".seg-dc").evaluate("element => element.getBoundingClientRect().width > 0")
    assert sum(int(value) for value in re.findall(r"(\d+)%", mix.locator(".system-use-legend").inner_text())) == 100
    expect(page.locator(".gauge-number")).to_contain_text("81")


def test_chart_controls(page: Page):
    open_demo(page)
    battery = page.get_by_role("button", name="Battery level", exact=True)
    expect(battery).to_have_attribute("aria-pressed", "true")
    expect(page.locator(".recharts-line path.recharts-curve")).to_be_visible()
    expect(page.locator(".recharts-yAxis")).to_have_count(2)
    expect(page.locator(".recharts-yAxis").last).to_contain_text("100%")
    battery.click()
    expect(battery).to_have_attribute("aria-pressed", "false")
    expect(page.locator(".recharts-line path.recharts-curve")).to_have_count(0)
    battery.click()
    expect(battery).to_have_attribute("aria-pressed", "true")
    solar = page.get_by_role("button", name="Solar", exact=True)
    solar.click()
    expect(solar).to_have_attribute("aria-pressed", "false")
    solar.click()
    expect(solar).to_have_attribute("aria-pressed", "true")
    page.get_by_role("button", name="24 hours", exact=True).click()
    expect(page.get_by_role("button", name="24 hours", exact=True)).to_have_attribute("aria-pressed", "true")


def test_device_search(page: Page):
    open_demo(page)
    page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Devices", exact=True).click()
    expect(page.get_by_role("heading", name="SmartSolar MPPT 250/70")).to_be_visible()
    page.get_by_role("searchbox").fill("Temperature")
    expect(page.locator(".device-panel")).to_have_count(1)
    expect(page.locator(".device-reading")).to_contain_text("Dc/0/Temperature")
    page.get_by_role("searchbox").fill("does-not-exist")
    expect(page.get_by_role("heading", name="No matching readings.")).to_be_visible()


def test_demo_preferences_never_save_to_server(page: Page):
    writes = []
    page.on("request", lambda request: writes.append(request.url) if request.method == "PUT" else None)
    open_demo(page)
    page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Settings", exact=True).click()
    page.get_by_role("radio", name="Every 5 minutes").check()
    page.get_by_role("button", name="Save preferences").click()
    expect(page.get_by_role("status")).to_have_text("Preview updated. Nothing saved.")
    assert writes == []


def test_reports_tabs_ranges_and_split_labels(page: Page):
    open_demo(page)
    page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Reports", exact=True).click()
    expect(page.get_by_role("heading", name="Reports.")).to_be_visible()
    expect(page.locator(".gen-stat.total").first).to_contain_text("Total output")
    finance = page.locator(".finance-panel")
    expect(finance).to_contain_text("0.6431")
    expect(finance).to_contain_text("11 L measured across 3 runs")
    price = page.get_by_label("Fuel price")
    price.fill("10")
    expect(finance).to_contain_text("N$ 761.46")
    price.fill("20")
    expect(finance).to_contain_text("N$ 1,522.93")
    assert page.evaluate("localStorage.getItem('helio-generator-fuel-price')") == "20"
    price.fill("")
    expect(finance.get_by_text("Enter fuel price above")).to_be_visible()
    assert page.evaluate("localStorage.getItem('helio-generator-fuel-price')") is None
    expect(page.locator(".split-bar .seg-charging")).to_be_visible()
    labels = page.locator(".split-labels span").all_inner_texts()
    assert sum(int(re.sub(r"\D", "", label) or 0) for label in labels) == 100
    for kind in ["Solar", "Consumption"]:
        page.get_by_role("button", name=kind, exact=True).click()
        expect(page.get_by_role("button", name=kind, exact=True)).to_have_attribute("aria-pressed", "true")
    expect(page.locator(".generator-stats").first).to_contain_text("Grid import")
    # Round-trip back to Generator: only the matching payload may render.
    page.get_by_role("button", name="Generator", exact=True).click()
    expect(page.locator(".gen-stat.total").first).to_contain_text("Total output")
    # Demo DC coverage is partial, so the coverage note shows.
    expect(page.locator(".report-note").filter(has_text="DC loads (GX)")).to_be_visible()
    for label in ["7 days", "30 days", "90 days", "This month", "365 days"]:
        page.get_by_role("button", name=label, exact=True).click()
        expect(page.get_by_role("button", name=label, exact=True)).to_have_attribute("aria-pressed", "true")
    page.get_by_label("Start date").fill("2026-08-01")
    expect(page.get_by_role("button", name="Custom")).to_have_attribute("aria-pressed", "true")


def test_report_run_log_fits_phone_width(page: Page):
    page.set_viewport_size({"width": 320, "height": 900})
    open_demo(page)
    page.get_by_role("navigation", name="Main navigation").get_by_role("link", name="Reports", exact=True).click()
    table = page.locator(".report-table-scroll").last
    for report_table in page.locator(".report-table-scroll").all():
        assert report_table.evaluate("element => element.scrollWidth <= element.clientWidth")
    expect(table.locator("td[data-label='Peak output']").first).to_be_visible()
    assert table.evaluate("element => element.scrollWidth <= element.clientWidth")
    assert table.locator("td[data-label='Peak output']").first.evaluate(
        "element => element.getBoundingClientRect().right <= element.closest('.report-table-scroll').getBoundingClientRect().right"
    )


@pytest.mark.parametrize("width", [320, 390, 768, 1440])
def test_responsive_layout_and_exit(page: Page, width):
    page.set_viewport_size({"width": width, "height": 900})
    open_demo(page)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
    page.locator("button:visible").filter(has_text="Exit demo").first.click()
    expect(page.get_by_label("Username", exact=True)).to_be_visible()


@pytest.mark.skipif(not os.getenv("HELIO_TEST_PASSWORD"), reason="Requires an explicitly configured test account")
def test_login_and_logout(page: Page):
    page.goto(BASE)
    page.get_by_label("Username", exact=True).fill(os.environ.get("HELIO_TEST_USERNAME", "owner"))
    page.locator('input[name="password"]').fill(os.environ["HELIO_TEST_PASSWORD"])
    page.get_by_role("button", name="Sign in to your workspace").click()
    expect(page.get_by_role("heading", name="Hello, brighter day.")).to_be_visible()
    assert page.request.get(f"{BASE}/api/live").status == 200
    page.locator('button[aria-label="Sign out"]:visible').first.click()
    expect(page.get_by_label("Username", exact=True)).to_be_visible()
    assert page.request.get(f"{BASE}/api/live").status == 401
