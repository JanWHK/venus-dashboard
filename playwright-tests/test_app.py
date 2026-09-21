"""Helio browser regression tests. Default tests use only the explicit demo."""
import os

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
    expect(page.locator(".gauge-number")).to_contain_text("81")


def test_chart_controls(page: Page):
    open_demo(page)
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
