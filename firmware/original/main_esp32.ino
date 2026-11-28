// Trinetra Systems - all-in-one offline test + load-cell tamper alarm
// Load cells + HX711, 2 IR sensors, 2 traffic lights, buzzer, OLED. No server needed.
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "HX711.h"

// ---------- Pins (your NodeMCU ESP-32S) ----------
const int PIN_HX_DT = 16, PIN_HX_SCK = 4;       // P16, P4
const int PIN_IR_ENTRY = 34, PIN_IR_EXIT = 35;  // P34, P35
const int IN_R = 26, IN_Y = 27, IN_G = 13;      // entry light
const int OUT_R = 32, OUT_Y = 33, OUT_G = 25;   // exit light
const int PIN_BUZZER = 18;                      // P18, LOW = beep

// ---------- Weighing settings ----------
const float CAL_FACTOR  = 15.53f;  // your calibration value
const int   N           = 10;      // readings averaged (~1 second)
const float STEADY_G    = 15;      // all readings within +-15 g = steady
const float ROUND_G     = 10;      // show to nearest 10 g
const float ZERO_G      = 20;      // below this shows 0
const float EMPTY_G     = 50;      // below this the platform is empty
const float TRUCK_MIN_G = 150;     // above this a truck is on the platform
const unsigned long HOLD_MS = 2000;  // steady this long -> lock

// ---------- Tamper settings ----------
const long  SAT_RAW      = 8300000;   // raw at HX711 limit = a cell wire is open
const float NEG_LIMIT_G  = -500;      // impossible negative weight = wire shorted
const int   STUCK_COUNT  = 15;        // same raw value this many times = stuck
const unsigned long NO_DATA_MS     = 1000;  // HX711 silent this long = DT/SCK/power cut
const unsigned long CONFIRM_MS     = 300;   // fault must last this long -> alarm
const unsigned long CLEAR_MS       = 3000;  // healthy this long -> alarm stops

HX711 scale;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);

float buf[N]; int bi = 0; bool bfull = false;
float avgG = 0; bool steady = false;
long lastRaw = 0, prevRaw = 0; int sameCount = 0;
unsigned long lastDataMs = 0;

enum State { IDLE, ARRIVING, POSITIONING, WEIGHED, TAMPER };
const char* STATE_NAMES[] = { "IDLE", "ARRIVING", "POSITIONING", "WEIGHED", "TAMPER" };
State state = IDLE;
unsigned long stateSince = 0, steadySince = 0, clearSince = 0;
unsigned long zeroSince = 0, lastZero = 0, faultSince = 0, okSince = 0;
float lockedG = 0;
const char* faultReason = "";
String lastScreen;

// ---------- Helpers ----------
bool entryBlocked() { return digitalRead(PIN_IR_ENTRY) == LOW; }
bool exitBlocked()  { return digitalRead(PIN_IR_EXIT)  == LOW; }

void setLight(int r, int y, int g, char c) {
  digitalWrite(r, c == 'R'); digitalWrite(y, c == 'Y'); digitalWrite(g, c == 'G');
}
void entryLight(char c) { setLight(IN_R, IN_Y, IN_G, c); }
void exitLight(char c)  { setLight(OUT_R, OUT_Y, OUT_G, c); }

void beepTimes(int n) {
  for (int i = 0; i < n; i++) {
    digitalWrite(PIN_BUZZER, LOW);  delay(120);
    digitalWrite(PIN_BUZZER, HIGH); delay(120);
  }
}

String fmtG(float g) { return String((long)g) + " g"; }

void show(const String& title, const String& big, const String& foot) {
  String key = title + "|" + big + "|" + foot;
  if (key == lastScreen) return;
  lastScreen = key;
  oled.clearDisplay();
  oled.setTextSize(1); oled.setCursor(0, 0);  oled.print(title);
  oled.setTextSize(2); oled.setCursor(0, 22); oled.print(big);
  oled.setTextSize(1); oled.setCursor(0, 54); oled.print(foot);
  oled.display();
}

void resetBuffer() { bi = 0; bfull = false; sameCount = 0; }

void readScale() {
  if (!scale.is_ready()) return;
  long raw = scale.read();
  lastDataMs = millis();
  sameCount = (raw == prevRaw) ? sameCount + 1 : 0;
  prevRaw = raw; lastRaw = raw;

  buf[bi] = (raw - scale.get_offset()) / scale.get_scale();
  bi = (bi + 1) % N; if (bi == 0) bfull = true;
  int n = bfull ? N : bi;
  if (n == 0) return;
  float s = 0, mn = 1e9, mx = -1e9;
  for (int i = 0; i < n; i++) { s += buf[i]; mn = min(mn, buf[i]); mx = max(mx, buf[i]); }
  avgG = s / n;
  steady = bfull && (mx - mn) <= 2 * STEADY_G;
}

float shownG() {
  if (fabs(avgG) < ZERO_G) return 0;
  return round(avgG / ROUND_G) * ROUND_G;
}

// Returns a reason if the load-cell wiring looks tampered, otherwise nullptr
const char* checkFault(unsigned long now) {
  if (now - lastDataMs > NO_DATA_MS)            return "HX711 NO DATA";
  if (lastRaw >= SAT_RAW || lastRaw <= -SAT_RAW) return "CELL WIRE OPEN";
  if (sameCount >= STUCK_COUNT)                 return "HX711 STUCK";
  if (bfull && avgG < NEG_LIMIT_G)              return "CELL WIRE FAULT";
  return nullptr;
}

void autoZero(unsigned long now) {
  if (steady && fabs(avgG) < 30 && fabs(avgG) > 3) {
    if (!zeroSince) zeroSince = now;
    if (now - zeroSince > 3000 && now - lastZero > 10000) {
      scale.tare(5); resetBuffer(); lastZero = now; zeroSince = 0;
      Serial.println("Auto-zero");
    }
  } else zeroSince = 0;
}

void goTo(State s) {
  state = s; stateSince = millis(); steadySince = 0; clearSince = 0; okSince = 0;
  Serial.printf("-> %s\n", STATE_NAMES[s]);
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, HIGH);
  int outs[] = { IN_R, IN_Y, IN_G, OUT_R, OUT_Y, OUT_G };
  for (int p : outs) pinMode(p, OUTPUT);
  entryLight('R'); exitLight('R');
  pinMode(PIN_IR_ENTRY, INPUT);
  pinMode(PIN_IR_EXIT, INPUT);

  Wire.begin(21, 22);
  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("OLED not found");
  oled.setTextColor(SSD1306_WHITE);
  show("TRINETRA", "STARTING", "Keep platform empty");

  scale.begin(PIN_HX_DT, PIN_HX_SCK);
  scale.set_scale(CAL_FACTOR);
  delay(1000);
  if (scale.wait_ready_timeout(2000)) {
    scale.tare(20);
    lastDataMs = millis();
    beepTimes(1);
    goTo(IDLE);
  } else {
    faultReason = "HX711 NO DATA";
    Serial.println("!!! TAMPER: HX711 NO DATA at start");
    goTo(TAMPER);
  }
}

// ---------- Main loop ----------
void loop() {
  readScale();
  unsigned long now = millis();
  bool inB = entryBlocked(), outB = exitBlocked();

  // ---- Tamper watch: runs in every state ----
  const char* fault = checkFault(now);
  if (fault) {
    if (!faultSince) faultSince = now;
    if (state != TAMPER && now - faultSince >= CONFIRM_MS) {
      faultReason = fault;
      Serial.printf("!!! TAMPER: %s\n", fault);
      goTo(TAMPER);
    }
  } else faultSince = 0;

  switch (state) {
    case IDLE:
      entryLight('R'); exitLight('R');
      show("TRINETRA   READY", fmtG(shownG()), "Waiting for truck");
      autoZero(now);
      if (inB && avgG < EMPTY_G) { beepTimes(1); goTo(ARRIVING); }
      break;

    case ARRIVING:
      entryLight('G'); exitLight('R');
      show("TRUCK ARRIVING", "DRIVE ON", "Entry light is green");
      if (avgG > TRUCK_MIN_G) goTo(POSITIONING);
      else if (!inB && now - stateSince > 15000) goTo(IDLE);
      break;

    case POSITIONING:
      entryLight('R'); exitLight('R');
      if (avgG < EMPTY_G && !inB && !outB) { goTo(IDLE); break; }
      if (inB) {
        entryLight('Y');
        show("POSITION TRUCK", fmtG(shownG()), "Move FORWARD");
        steadySince = 0; break;
      }
      if (outB) {
        exitLight('Y');
        show("POSITION TRUCK", fmtG(shownG()), "Move BACK");
        steadySince = 0; break;
      }
      show("WEIGHING...", fmtG(shownG()), "Hold still");
      if (steady && avgG > TRUCK_MIN_G) {
        if (!steadySince) steadySince = now;
        if (now - steadySince >= HOLD_MS) {
          lockedG = shownG();
          Serial.printf("WEIGHT LOCKED: %.0f g\n", lockedG);
          beepTimes(2);
          goTo(WEIGHED);
        }
      } else steadySince = 0;
      break;

    case WEIGHED:
      entryLight('R'); exitLight('G');
      show("WEIGHT LOCKED", fmtG(lockedG), "Drive off ->");
      if (avgG < EMPTY_G && !inB && !outB) {
        if (!clearSince) clearSince = now;
        if (now - clearSince > 2000) goTo(IDLE);
      } else clearSince = 0;
      break;

    case TAMPER: {
      bool on = (now / 250) % 2;                     // toggles 4 times a second
      digitalWrite(PIN_BUZZER, on ? LOW : HIGH);     // continuous alarm beeping
      entryLight(on ? 'R' : 'Y'); exitLight(on ? 'R' : 'Y');
      show("!!! TAMPER ALERT !!!", "WIRES", faultReason);
      if (!fault) {
        if (!okSince) okSince = now;
        if (now - okSince > CLEAR_MS) {              // wires healthy for 3 s
          digitalWrite(PIN_BUZZER, HIGH);
          Serial.println("Wiring OK again - re-zeroing (platform must be empty)");
          show("TAMPER CLEARED", "RE-ZERO", "Keep platform empty");
          delay(1000);
          scale.tare(20); resetBuffer(); lastDataMs = millis();
          goTo(IDLE);
        }
      } else okSince = 0;
      break;
    }
  }
  delay(20);
}