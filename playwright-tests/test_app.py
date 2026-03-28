"""Playwright tests for Venus OS Dashboard.

Run:
    cd playwright-tests
    pip install -r requirements.txt
    playwright install chromium
    pytest -v
"""
import json
import re
import time
import urllib.request

import pytest
from playwright.sync_api import Page, expect

BASE = "http://localhost:8081"


# ── helpers ──────────────────────────────────────────────────────────────────


def open_dashboard(page: Page):
    page.goto(BASE)
    page.wait_for_load_state("networkidle")


def open_settings(page: Page):
    page.goto(f"{BASE}/settings")
    page.wait_for_load_state("networkidle")


# ── tests ─────────────────────────────────────────────────────────────────────


def test_app_loads(page: Page):
    """Home page renders without errors."""
    open_dashboard(page)
    expect(page.locator("text=Venus OS")).to_be_visible()
    expect(page.locator("[data-testid=time-range-selector]")).to_be_visible()


def test_settings_page_loads(page: Page):
    """Settings page shows interval selector."""
    open_settings(page)
    expect(page.locator("[data-testid=interval-select]")).to_be_visible()
    expect(page.locator("[data-testid=save-btn]")).to_be_visible()


def _api_put_settings(interval_seconds: int):
    req = urllib.request.Request(
        f"{BASE}/api/settings",
        data=json.dumps({"interval_seconds": interval_seconds}).encode(),
        method="PUT",
        headers={"Content-Type": "application/json"},
    )
    urllib.request.urlopen(req)


def test_settings_change_interval(page: Page):
    """Change interval to 5s, save, verify toast and disabled state resets."""
    _api_put_settings(60)  # ensure known starting state
    open_settings(page)

    # Select 5 seconds
    page.select_option("[data-testid=interval-select]", "5")
    expect(page.locator("[data-testid=save-btn]")).to_be_enabled()

    # Save
    page.click("[data-testid=save-btn]")
    expect(page.locator("[data-testid=toast]")).to_contain_text("Saved")

    # After save, button should be disabled again (selected == saved)
    expect(page.locator("[data-testid=save-btn]")).to_be_disabled()

    # Reset back to 60s so other tests aren't affected
    page.select_option("[data-testid=interval-select]", "60")
    page.click("[data-testid=save-btn]")
    expect(page.locator("[data-testid=toast]")).to_contain_text("Saved")


def test_metric_toggle_hides_chart(page: Page):
    """Unchecking all battery metrics hides the battery chart."""
    open_dashboard(page)

    # Battery chart should be visible initially
    expect(page.locator("[data-testid=chart-battery]")).to_be_visible()

    # Uncheck all battery metrics
    for key in ["battery_soc", "battery_voltage", "battery_current"]:
        checkbox = page.locator(f"[data-testid=metric-toggle-{key}] input")
        if checkbox.is_checked():
            checkbox.uncheck()

    # Battery chart should disappear
    expect(page.locator("[data-testid=chart-battery]")).not_to_be_visible()

    # Re-enable
    for key in ["battery_soc", "battery_voltage", "battery_current"]:
        page.locator(f"[data-testid=metric-toggle-{key}] input").check()


def test_time_range_buttons(page: Page):
    """Clicking a time range button changes the active style."""
    open_dashboard(page)

    btn_1h = page.locator("[data-testid=range-1h]")
    btn_6h = page.locator("[data-testid=range-6h]")

    # Click 6h
    btn_6h.click()
    expect(btn_6h).to_have_class(re.compile(r"bg-green-700"))
    expect(btn_1h).not_to_have_class(re.compile(r"bg-green-700"))

    # Click back to 1h
    btn_1h.click()
    expect(btn_1h).to_have_class(re.compile(r"bg-green-700"))


@pytest.mark.slow
def test_readings_appear_after_collection(page: Page):
    """With a 5s interval, data rows should appear within ~20s.

    Requires the Venus OS device to be reachable at 192.168.178.103.
    Skip if not in a live environment.
    """
    # Set interval to 5s
    open_settings(page)
    page.select_option("[data-testid=interval-select]", "5")
    page.click("[data-testid=save-btn]")
    expect(page.locator("[data-testid=toast]")).to_contain_text("Saved")

    # Go to dashboard
    open_dashboard(page)

    # Wait up to 30s for data to appear (charts render only when data exists)
    page.wait_for_selector(
        "[data-testid=chart-battery]",
        state="visible",
        timeout=30000,
    )

    # Reset interval
    open_settings(page)
    page.select_option("[data-testid=interval-select]", "60")
    page.click("[data-testid=save-btn]")
