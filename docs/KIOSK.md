# Kiosk

`/kiosk` is a page for a screen that stays on, such as a small display on a desk or a spare tablet. It shows what the firmware's watch shows, with large type.

> **Status:** built and tested in a desktop Chromium at 800x480 and 1024x600. **It has not been tried on a real Raspberry Pi, a tablet or a long-lived screen**, so the advice below about those is from the browser's documentation, not from experience.

## What it shows

- The connection state (Live, Stale, Offline, and the others), the count of working sessions and of sessions that need you, and the total.
- Up to **six** sessions, the ones that matter first (the server's own order), each with its project, agent, status and a running or waiting time. If there are more: `+ N more`. The counters above always cover every session.
- Usage bars for the agents that reported them.
- The NEEDS YOU alert, the task-done celebration, meeting mode and the idle robot, exactly as on the other pages.

It has no navigation. **Close kiosk** goes back to the dashboard. A tap on **Full screen** asks the browser for full screen (a browser only allows that after a user action).

## It must not scroll

The page fits **800x480 and 1024x600 without scrolling**, with at most six rows. This is tested (`e2e/kiosk.spec.ts`) with 14 real sessions. Below 520 px of height the row spacing and the counters shrink so that six rows and the `+ N more` line still fit. Every control is at least 48 px tall, so a finger can hit it.

## Keeping the screen awake

- The page asks the browser for a **screen wake lock**. A browser only grants it in a **secure context**: `https://`, or `http://localhost`. On plain `http://192.168.x.x` it is refused, and the page says so ("This browser cannot keep the screen on here (it needs HTTPS or localhost). Use the system setting.").
- So on a device that opens the page by LAN address, turn off the screen timeout in the **system** settings, or serve the page over TLS, or open it as `http://localhost` (for example when the browser runs on the same machine as the container).
- The mouse pointer hides after 5 seconds without moving.

## Burn-in and brightness

- The picture shifts by a few pixels every minute, using transforms only, so a still image does not sit on the same pixels. **That does not guarantee against burn-in** on an OLED screen, and a browser cannot promise it.
- A browser **cannot change the hardware brightness**. Meeting mode dims by lowering the opacity of the content, which on an AMOLED panel (true black ground) does reduce light, but it is not a brightness control.
- The idle robot appears after 15 minutes without a touch or a change, and moves to a new corner every 30 seconds, which is also a way to keep the picture moving. A touch wakes it, and the tap that woke it does nothing else.

## Running it on a small computer

Anything with a current browser and a network connection works. As an example (not tested on a Pi), Chromium can open the page as an app in full screen:

```sh
chromium --kiosk --noerrdialogs --disable-infobars http://<address>:8080/kiosk
```

Add the login to the address only if you use one (`http://user:password@host`); that puts the password in the command line, so on a shared machine prefer a private network and no login. Start it from the desktop's autostart, and turn off the screen blanking of the desktop.

## Load

The page asks the server once every 3 seconds (20 requests a minute, none when the tab is hidden). In a 45-minute run with data changing, the JavaScript heap of the kiosk went from 3.9 to 5.1 MiB, mostly in the first 10 minutes and then about 0.4 MiB an hour, and its main thread was busy 0.24 % of the time (`PERFORMANCE.md`). That was on a desktop PC: the idle CPU **on a Raspberry Pi 4 has not been measured**, so the target "under 3 %" is open, and a 24-hour soak has not been run.
