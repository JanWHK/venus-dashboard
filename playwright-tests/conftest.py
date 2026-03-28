import pytest

BASE_URL = "http://localhost:8081"


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: marks tests that wait for live data")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL
