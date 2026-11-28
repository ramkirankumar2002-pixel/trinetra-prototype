# Hardware guide

How to wire, flash, calibrate and test the three boards: the **main ESP32** (the weighbridge) and **two ESP32-CAM** boards (front and back plate cameras). The messages they speak are in the [README](../README.md#device-connection).

**Not yet tried on the real boards.** Both sketches compile (see [Compile check](#compile-check)) and the backend was tested with pretend boards that send the same messages. Use the [first power-on checklist](#first-power-on-checklist) the first time.

## 1. Wiring

### Main board: NodeMCU ESP-32S

| Part | Part's pin | ESP32 pin | Notes |
| --- | --- | --- | --- |
| HX711 | DT | GPIO 16 (P16) | |
| HX711 | SCK | GPIO 4 (P4) | |
| HX711 | VCC, GND | 3V3, GND | Keep it as in your working offline weighbridge. On 3V3, DT stays at a voltage the ESP32 can take |
| Load cells | E+, E−, A+, A− | on the HX711 | As already wired |
| IR sensor, entry end | OUT | GPIO 34 (P34) | LOW = blocked. This pin is input only, with no pull-up: the sensor module must drive it |
| IR sensor, exit end | OUT | GPIO 35 (P35) | The same |
| IR sensors | VCC, GND | 3V3, GND | |
| Entry traffic light | Red, Yellow, Green | GPIO 26, 27, 13 | HIGH = on. A bare LED needs a resistor of about 220–330 Ω |
| Exit traffic light | Red, Yellow, Green | GPIO 32, 33, 25 | The same |
| Buzzer | signal | GPIO 18 | LOW = beep |
| OLED SSD1306 128×64 | SDA, SCL | GPIO 21, GPIO 22 | I2C address 0x3C |
| OLED | VCC, GND | 3V3, GND | |

All grounds must be joined. "Entry" is the end where the truck drives **on**; "exit" is where it drives **off**.

### Cameras: 2 × AI-Thinker ESP32-CAM

They are **not** connected to the main ESP32. Each needs only power:

- from its **ESP32-CAM-MB** board through USB, or from 5 V and GND pins.
- Use a supply of at least **1 A for each camera** (a phone charger). A weak supply or a long thin cable makes the camera restart again and again ("brownout" in the Serial Monitor).

The flash LED stays off.

## 2. What to install

1. **Arduino IDE 2** (<https://www.arduino.cc/en/software>).
2. The ESP32 boards: **File → Preferences → Additional boards manager URLs**:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   then **Tools → Board → Boards Manager**, search `esp32`, install **esp32 by Espressif Systems**. Compiled here with version **4.0.0**.
3. Libraries (**Tools → Manage Libraries**). Check the author: several libraries have similar names.

| Library name (type this) | Author | Version compiled here | Used by |
| --- | --- | --- | --- |
| HX711 Arduino Library | Bogdan Necula (bogde) | 0.7.5 | Main board |
| WebSockets | Markus Sattler (links2004) | 2.7.2 | Main board |
| ArduinoJson | Benoit Blanchon | 7.4.3 | Main board |
| Adafruit SSD1306 | Adafruit | 2.5.17 | Main board (say **Install all** for what it needs) |
| Adafruit GFX Library | Adafruit | 1.13.0 | Main board |

The cameras need no extra library.

4. The **USB driver**, if Windows shows no COM port when you plug a board in: **CH340** (usual on the ESP32-CAM-MB) or **CP210x** (usual on NodeMCU boards). Use a USB cable that carries data; many charging cables do not.

## 3. Board settings

Pick these under **Tools** before uploading.

| Setting | Main board | Each camera |
| --- | --- | --- |
| Board | **ESP32 Dev Module** | **AI Thinker ESP32-CAM** |
| Partition Scheme | **Default** (Default 4MB with spiffs) | Leave as the board sets it |
| PSRAM | Disabled | **Enabled** (if the menu is not shown, the board already has it on) |
| Upload Speed | 921600 (use 115200 if uploading fails) | The same |
| Port | The board's COM port | The same |
| Serial Monitor | 115200 baud | 115200 baud |

## 4. Fill in secrets.h

`secrets.h` holds your Wi-Fi password and the device tokens. **Git ignores it. Never put real values in `secrets.example.h`.**

1. In `firmware/esp32/`, copy `secrets.example.h` and name the copy `secrets.h`.
2. Do the same in `firmware/esp32-cam/`.

```powershell
Copy-Item firmware/esp32/secrets.example.h firmware/esp32/secrets.h
```

```powershell
Copy-Item firmware/esp32-cam/secrets.example.h firmware/esp32-cam/secrets.h
```

3. Fill in the values:

| Line | What to put |
| --- | --- |
| `WIFI_SSID`, `WIFI_PASSWORD` | Your phone hotspot's name and password, exactly (capital letters count) |
| `SERVER_URL` | See [the next section](#5-which-server-address) |
| `DEVICE_TOKEN` (main board) | The same value as `DEVICE_TOKEN` in `apps/server/.env` |
| `CAM_FRONT_TOKEN`, `CAM_BACK_TOKEN` (cameras) | The same values as in `apps/server/.env` |
| `CAM_NAME` (cameras) | `"front"` or `"back"` |

If a token in `apps/server/.env` is empty, make one (run it once for each of the three; each at least 16 characters, all different), paste it into `.env`, and restart the backend:

```powershell
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

## 5. Which server address

| How the backend runs | `SERVER_URL` on all three boards |
| --- | --- |
| `pnpm dev` on your laptop | `http://<laptop IPv4 address>:4000` |
| `pnpm lan` on your laptop | **The same**: `http://<laptop IPv4 address>:4000` |
| Deployed (Phase 16) | `https://<your-app>.up.railway.app` (the board then uses `wss://` by itself), with the tokens set on Railway |

- It is **port 4000** (the backend), never 3000, and never `localhost`: on a board, `localhost` means the board itself.
- With `pnpm lan`, phones and browsers use `https://<laptop address>:3000`; the boards still use `http` on port 4000.
- **The laptop's address can change** when the hotspot restarts. Then change `SERVER_URL` and upload all three again. Check the address each time.

### The phone hotspot (2.4 GHz only)

The ESP32 cannot see 5 GHz Wi-Fi.

- **Android:** Settings → Network & internet (or Connections) → Hotspot → Wi-Fi hotspot → **AP band** or **Band** → **2.4 GHz**. Security: WPA2. Turn off "Turn off hotspot automatically".
- **iPhone:** Settings → Personal Hotspot → turn on **Maximize Compatibility**. Keep that screen open while the boards join the first time.
- A name and password with only plain English letters and numbers is safest.

Then connect the **laptop** to the same hotspot and find its address:

```powershell
ipconfig
```

Take the **IPv4 Address** under "Wireless LAN adapter Wi-Fi" (such as `192.168.43.12`).

**Windows firewall:** the boards connect *to* the laptop, so Windows must let them in. Windows Security → Firewall & network protection → Allow an app through firewall → **Node.js JavaScript Runtime** → tick **Private**. Set the hotspot Wi-Fi to **Private network** (Settings → Network & internet → Wi-Fi → the hotspot).

To test it, open `http://<laptop address>:4000/api/health` in the **phone's** browser. It must say `"status":"ok"`.

## 6. How to flash

**Open the sketch's own folder** in the Arduino IDE (File → Open): `firmware/esp32/esp32.ino` or `firmware/esp32-cam/esp32-cam.ino`. `secrets.h` appears as a second tab.

### Main board

1. Plug it in with USB. **Keep the platform empty** (it zeroes itself when it starts).
2. Tools: **ESP32 Dev Module** and the COM port.
3. Press **Upload** (the arrow). If it waits at `Connecting....`, hold the board's **BOOT** button until the upload starts.
4. Open the **Serial Monitor** at **115200**.

### Each camera, with the ESP32-CAM-MB

1. Push the ESP32-CAM onto the **ESP32-CAM-MB** (camera lens facing away from the MB's USB board; the pins must line up with the labels).
2. In `secrets.h` set `#define CAM_NAME "front"`.
3. Tools: **AI Thinker ESP32-CAM** and the COM port.
4. Press **Upload**. If it fails with "Failed to connect": hold the **IO0** button on the MB, press and release **RST**, press Upload, and let go of IO0 when it says `Writing`.
5. After "Hard resetting", press **RST** once. Open the Serial Monitor at 115200.
6. **Label this camera "FRONT".**
7. Change the one line to `#define CAM_NAME "back"`, unplug, plug in the **second** camera, and upload again. Label it **"BACK"**.

## 7. On the laptop, once

After getting this update, load the new settings (the weighbridge will not weigh without them). Tickets are kept; the demo switches go back to **Real**.

```powershell
pnpm install
```

```powershell
pnpm db:migrate
```

```powershell
pnpm db:seed
```

Only one program can use port 3000 or 4000: close any other test server (such as one you used with the offline sketches) before `pnpm dev`.

Check the backend before touching the boards (with `pnpm dev` running, boards off and no `pnpm sim`). Every line must say `PASS`:

```powershell
pnpm fake-hardware
```

## First power-on checklist

Do the steps in order. Go on only when you see what is written. On the laptop keep open: <http://localhost:3000/kiosk> (`wb01`, PIN `3001`) and, **in another browser or a private window**, <http://localhost:3000/settings> (`ram`, PIN `2001`). With `pnpm lan` use `https://`.

The main board prints one line a second: `weight 0.4 g  raw …  zero …  steady  entry clear  exit clear  online`.

| # | Do | OLED | Serial Monitor | Website | If it fails |
| --- | --- | --- | --- | --- | --- |
| 1 | `pnpm dev`, then `pnpm fake-hardware`; stop it | — | — | `ALL PASSED` in the terminal | Run `pnpm db:seed`; check the three tokens and `ADMIN_PIN` in `apps/server/.env` |
| 2 | Power the main board, platform **empty** | `STARTING`, `Keep platform empty` | `Trinetra weighbridge`, then `Zero taken` | Weighbridge offline | Nothing on the OLED: check SDA 21, SCL 22, 3V3 (`OLED not found` in Serial). `!!! TAMPER: HX711 NO DATA`: check DT 16, SCK 4 and the HX711's power |
| 3 | Wait (hotspot on) | `No Wi-Fi` / `OFFLINE` / `- do not drive on`, then `No server` | `Wi-Fi connected, IP …` | — | Stays on `No Wi-Fi`: hotspot on 2.4 GHz; name and password in `secrets.h` |
| 4 | Wait | `TRINETRA READY` / `DRIVE ON`; entry **green**, exit **red** | `Server connected`, then lines starting `<- {"t":"light"…` | Kiosk: **Weighbridge online**. Settings: Main ESP32 **Online** | `No server`: `SERVER_URL` (laptop address, port 4000), firewall, health page from the phone. `Check DEVICE_TOKEN`: the token does not match `.env`. In both cases both lights stay red |
| 5 | Put a known weight on the platform | Unchanged | `weight` near the true grams, then `steady` | The kiosk's live weight is grams × 100 | Wrong figure: [calibrate](#calibration). Negative figure: put a minus sign before `CAL_FACTOR` |
| 6 | Take it off | — | `weight` near 0; sometimes `Auto-zero` | `0 kg` | Not 0: type `t` and Enter in the Serial Monitor with the platform empty |
| 7 | Cover the **entry** IR sensor with your hand, platform empty | Unchanged | `entry BLOCKED`; one short beep | — | Never `BLOCKED`: check pin 34 and the sensor's small potentiometer. Always `BLOCKED`: the same |
| 8 | Put the truck (more than 150 g) over the entry sensor | `POSITION TRUCK`, weight, `Move FORWARD`; entry **yellow** | `<- … "buzz"`; a long beep | Kiosk: "Move fully onto the bridge" | Exit sensor: the same with `Move BACK` and a yellow exit light. Swapped: swap pins 34 and 35 |
| 9 | Move the truck fully on | `PLEASE` / `WAIT`; both **red** | `entry clear exit clear` | Kiosk asks for the language | Kiosk does not wake: the truck must weigh more than 100 g |
| 10 | **Tamper test:** pull the HX711's **DT** wire out of the ESP32 | `!!! TAMPER ALERT !!!` / `WIRES` / reason; lights flash red and yellow, alarm beeps | `!!! TAMPER: HX711 NO DATA` | Kiosk: **Weighbridge fault – please wait**. Store pages: red banner | No alarm: check you pulled DT. (Pull only a signal wire, never a load cell wire while it is under a load) |
| 11 | Put the wire back, platform empty | `RE-ZERO`, then ready | `Wiring OK again - re-zeroing`, `Zero taken` | The fault screen and banner go away | With a load on the platform it keeps the old zero, on purpose |
| 12 | Switch the hotspot off for 20 s, then on | `OFFLINE`; both **red**; then ready again by itself | `Wi-Fi lost`, later `Server connected` | Offline, then online | Press the board's reset button once |
| 13 | Power the **front** camera | — | `Trinetra camera: front`, `Camera OK`, `Connected, camera IP …`, `Sent … bytes -> 204 (OK)` | Settings: Front camera **Online**. Kiosk: `Cam 1/2` | `Camera init failed`: reseat the camera's ribbon cable, use a stronger supply. `401`: wrong token. `403`: token and `CAM_NAME` do not match. `-1` (cannot reach): `SERVER_URL`, firewall. Restarts again and again: weak power |
| 14 | Power the **back** camera | — | The same with `back` | Kiosk: `Cam 2/2` (green) | As above |
| 15 | On the kiosk, hold the Trinetra logo for 3 s | — | — | Each board **Online**, with "Last seen" | — |

## Calibration

The backend gets grams from the board, so calibrate the **board**; the truck scale (1 g = 100 kg) is a separate setting on the website.

1. Power the main board with the platform **completely empty**. Wait a minute for it to warm up.
2. In the Serial Monitor (115200) type `t` and press Enter. Wait for `Zero taken`. `weight` should now be near `0.0 g`.
3. Put on a **known weight**, as heavy as your loaded truck if you can: a kitchen-scale-checked object, or water in a bottle (1 ml = 1 g, plus the bottle's own weight). Place it in the middle.
4. Wait for `steady`. Note about ten `weight` figures and take their average: that is `shown`.
5. Work out the new factor: **new CAL_FACTOR = old CAL_FACTOR × shown ÷ true weight**.
   Example: factor 15.53, a true 500 g shows as 512 g → 15.53 × 512 ÷ 500 = **15.90**.
6. Change `CAL_FACTOR` near the top of `esp32.ino`, upload, and repeat steps 1–5 until the figure is within 1 g.
7. Check with the weight near each end and in the middle. A large difference between places is a mounting problem (a load cell touching something, or the platform not resting on all cells), not a calibration problem.

## Demo cargo and bills

**1 g on the model = 100 kg** of a truck (the setting "Model scale" on `/settings`). The model cargo is **200 g = 20,000 kg**.

A truck is weighed **loaded** (truck + cargo), the cargo is taken off, and it is weighed **empty**. The difference is the cargo, so the truck's own weight does not matter, as long as the **empty truck weighs more than 150 g**.

Each bill below says 20,000 kg. Print it, or send its file to the driver's phone, and put the matching plate on the model truck. They are in [scripts/sample-invoices](../scripts/sample-invoices), as `.jpg` and `.pdf`.

| Bill file | Material to choose | Plate on the truck | Type: who checks |
| --- | --- | --- | --- |
| `model-bricks` | Bricks | MH 14 CD 5678 | Type 3: nobody. **The simplest first run** |
| `model-cement` | Cement Bags | MH 12 AB 1234 | Type 1: supervisor `amit` |
| `model-steel-bars` | Steel Bars | RJ 14 LM 2345 | Type 1: supervisor `vikram` |
| `model-bitumen` | Bitumen | BR 06 QR 4321 | Type 1: `suresh` (trips 1–2), then `pankaj` |
| `model-steel-scrap` | Steel Scrap | UP 32 EF 9012 | Type 2: store officer |
| `model-sand` | Sand | MP 09 JK 7890 | Type 2: store officer |
| `model-aggregate` | Aggregate 20 mm | DL 01 NP 6789 | Type 2: store officer |

With "Bill reading" on **Pick**, choose the same bill on `/settings` (they are listed with "20,000 kg").

### PASS and HOLD

| Cargo that comes off | Net weight | Difference from 20,000 kg | Result |
| --- | --- | --- | --- |
| **200 g** (199–201 g) | 19,900 – 20,100 kg | 0.5% or less | **PASS** |
| **180 g** (the fraud demo: 20 g "stolen") | 18,000 kg | 10% | **HOLD**: the store officer decides |

> **The PASS window is only ±1 g.** The tolerance is 0.5% (a project rule), which is 1 g of 200 g. A hobby load cell may drift or wobble by more than that. The backend helps by averaging the 3 seconds in which the weight is still, but **test it ten times before showing anyone**.
>
> - Make the cargo **on this scale**: weigh the truck loaded and empty on the model, and add or remove small coins until the difference reads 200 g.
> - If PASS is still not reliable, use a **heavier cargo with a smaller scale**. The bills stay right, because the kilograms stay 20,000:
>
> | Cargo | Model scale | PASS window | A HOLD cargo |
> | --- | --- | --- | --- |
> | 200 g | 1 g = 100 kg | ±1 g | 180 g |
> | 500 g | 1 g = 40 kg | ±2.5 g | 450 g |
> | 1000 g | 1 g = 20 kg | ±5 g | 900 g |
>
> Check that the load cells can carry the truck plus that cargo. With a smaller scale, the 100 g "truck arrived" and 15 g "still" limits stay in grams, so nothing else changes.

## Running it for real

1. `pnpm lan` (the driver's phone needs it to open the bill upload page), boards powered, `pnpm sim` **not** running.
2. Kiosk: `https://localhost:3000/kiosk`. Store: `https://<laptop address>:3000/store`, or another browser on the laptop.
3. `/settings`: all three reading switches on **Real** (they need `PLATE_RECOGNIZER_TOKEN` and `GEMINI_API_KEY`). If one fails on stage, switch only that one to **Pick**.
4. Start with `model-bricks`: put the loaded truck on, choose the language, confirm the plate, send the bill from the phone, answer the questions, weigh. Drive off, take the cargo out, drive on again, weigh.

| Problem | Try |
| --- | --- |
| Plate not read, or read wrong | Bigger, sharper plate; more light; turn the lens ring gently to focus for the real distance; no glare. Then "Kiosk plate reading: Pick" |
| The weight never becomes still | Steady table, no fan on the platform; raise "Stable band" on `/settings` a little |
| The truck's weight is refused ("on the bridge" never) | It must be fully clear of both IR sensors |
| "Change the model scale" is refused | Take the truck off; finish open trucks, or "Reset demo data" |

## Compile check

Both sketches were compiled on 28 Nov 2026 with `arduino-cli` 1.6.0 (the one inside the Arduino IDE), ESP32 core 4.0.0 and the library versions above, using the example `secrets.h`. **Nothing was uploaded to a board.**

| Sketch | Board | Program space | Memory for variables |
| --- | --- | --- | --- |
| `esp32.ino` | ESP32 Dev Module | 1,196,552 of 1,310,720 bytes (91%) | 16% |
| `esp32-cam.ino` | AI Thinker ESP32-CAM | 1,205,871 of 3,145,728 bytes (38%) | 21% |

If the main sketch ever stops fitting, choose Partition Scheme **Huge APP**.

To compile again without flashing, use the IDE's **Verify** button (the tick).
