# Fresh Setup Guide

## Prerequisites
```bash
pip3 install paho-mqtt openpyxl playwright
playwright install chromium
```

## Hosts entry (required — www.venus.local doesn't resolve by default)
```bash
echo "192.168.178.103 www.venus.local" | sudo tee -a /etc/hosts
```
> Note: `venus.local` resolves fine, `www.venus.local` does not — add manually if needed.

## Cron job
```bash
crontab -e
# Add:
*/10 * * * * /usr/bin/python3 /home/janj/victron/venus_logger.py >> /home/janj/victron/venus_logger.log 2>&1
```

## Verify cron is set
```bash
crontab -l
```

## Test run (20 seconds, 1 row/sec)
```bash
# Edit the inline test script or run venus_logger.py directly:
python3 /home/janj/victron/venus_logger.py
```

## Discover all available MQTT topics (run once)
```bash
python3 /home/janj/victron/venus_discover.py
```

## Check the log
```bash
tail -f /home/janj/victron/venus_logger.log
```
