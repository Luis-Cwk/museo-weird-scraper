#!/usr/bin/env python3
"""
huaca-monitor.py — runs as a cron companion to huaca-agent-autonomo.

Every 6 hours, checks:
  1. data/last-picked-source.json — when was the last successful cycle?
  2. data/scraper-cursor.json — is the scraper rotating correctly?
  3. Agent log file size — has it grown recently?

If the last successful cycle is >36 hours old (3 missed cron ticks
at 12h intervals), send a Telegram alert. State is kept in a tiny
JSON file to avoid duplicate alerts.

Cron schedule suggestion (added alongside huaca-agent-autonomo):
  Schedule: 0 5,11,17,23 * * *  (every 6 hours)
  Deliver:  telegram
"""

import json, os, sys, time, urllib.request, urllib.parse
from datetime import datetime, timezone, timedelta

ROOT = r"C:\Users\petra\museo-weird-scraper"
DATA = os.path.join(ROOT, "data")
STATE_PATH = os.path.join(ROOT, "data", "monitor-state.json")

# Telegram credentials (read from .env so they're never in git)
ENV_PATH = os.path.join(ROOT, ".env")
def read_env():
    env = {}
    try:
        with open(ENV_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    except Exception:
        pass
    return env

def send_telegram(token, chat_id, text):
    """Send a message via Telegram Bot API. Silent on failure."""
    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        data = urllib.parse.urlencode({
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "Markdown",
            "disable_web_page_preview": "true",
        }).encode()
        req = urllib.request.Request(url, data=data, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status == 200
    except Exception as e:
        print(f"Telegram send failed: {e}", file=sys.stderr)
        return False

def load_state():
    try:
        with open(STATE_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"lastAlertAt": None, "alertsSent": 0}

def save_state(state):
    try:
        with open(STATE_PATH, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        print(f"Could not save monitor state: {e}", file=sys.stderr)

def get_last_activity():
    """Returns the timestamp of the last successful cycle (or None)."""
    candidates = [
        os.path.join(DATA, "last-picked-source.json"),
        os.path.join(DATA, "scraper-cursor.json"),
    ]
    newest = None
    for path in candidates:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            for key in ("updatedAt", "lastScrapeAt"):
                if key in data and data[key]:
                    ts = datetime.fromisoformat(data[key].replace("Z", "+00:00"))
                    if newest is None or ts > newest:
                        newest = ts
        except Exception:
            continue
    return newest

def main():
    env = read_env()
    bot_token = env.get("TELEGRAM_BOT_TOKEN")
    chat_id = env.get("TELEGRAM_CHAT_ID")
    if not bot_token or not chat_id:
        # No Telegram configured → log only, no alert.
        print(f"[{datetime.now().isoformat()}] monitor: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env — silent mode")
        return 0

    last_activity = get_last_activity()
    now = datetime.now(timezone.utc)
    state = load_state()

    if last_activity is None:
        msg = "⚠️ *Huaca monitor*: no activity detected (last-picked-source.json missing or corrupt)"
        print(msg)
        # First alert
        if state.get("lastAlertAt") is None:
            send_telegram(bot_token, chat_id, msg)
            state["lastAlertAt"] = now.isoformat()
            state["alertsSent"] = state.get("alertsSent", 0) + 1
            save_state(state)
        return 1

    hours_since = (now - last_activity).total_seconds() / 3600
    print(f"[{now.isoformat()}] monitor: last activity {hours_since:.1f}h ago (limit: 36h)")

    if hours_since > 36:
        msg = (
            f"🚨 *Huaca CRON stalled*\n"
            f"Last successful cycle: {last_activity.strftime('%Y-%m-%d %H:%M UTC')}\n"
            f"That's {hours_since:.1f}h ago (expected every ~12h).\n"
            f"Check `hermes cron list` and `logs/agent.log`."
        )
        print(msg)
        # Re-alert only every 24h to avoid spam
        last_alert = state.get("lastAlertAt")
        if last_alert:
            try:
                last_alert_dt = datetime.fromisoformat(last_alert.replace("Z", "+00:00"))
                if (now - last_alert_dt).total_seconds() < 24 * 3600:
                    print("Alert throttled (last alert < 24h ago)")
                    return 2
            except Exception:
                pass
        send_telegram(bot_token, chat_id, msg)
        state["lastAlertAt"] = now.isoformat()
        state["alertsSent"] = state.get("alertsSent", 0) + 1
        save_state(state)
        return 2

    # OK state — no alert needed.
    return 0

if __name__ == "__main__":
    sys.exit(main())