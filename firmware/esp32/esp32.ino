// Trinetra Systems - main weighbridge board (NodeMCU ESP-32S)
// Load cells + HX711, 2 IR sensors, 2 traffic lights, buzzer, OLED, load-cell tamper alarm.
//
// It measures GRAMS on the model and sends them to the Trinetra backend over a WebSocket.
// The backend turns grams into truck kilograms, decides the traffic lights and the display
// text, and is the only place a weight is ever saved. This board saves nothing.
//
// The board decides only three things by itself:
//   1. tamper alarm (always wins over everything),
//   2. OFFLINE: both lights red while the server cannot be reached,
//   3. yellow + "Move FORWARD / BACK" while a truck is being positioned.
//
// Before compiling: copy secrets.example.h to secrets.h and fill it in. See docs/HARDWARE.md.
// Libraries: "HX711 Arduino Library" (Bogdan Necula), "WebSockets" (Markus Sattler),
// "ArduinoJson" (Benoit Blanchon), "Adafruit SSD1306" and "Adafruit GFX Library".

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Ticker.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include "HX711.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "secrets.h is missing: copy secrets.example.h to secrets.h and fill it in."
#endif

// ---------- Pins (NodeMCU ESP-32S) ----------
const int PIN_HX_DT = 16, PIN_HX_SCK = 4;       // P16, P4
const int PIN_IR_ENTRY = 34, PIN_IR_EXIT = 35;  // P34, P35 (LOW = blocked, input only)
const int IN_R = 26, IN_Y = 27, IN_G = 13;      // entry light
const int OUT_R = 32, OUT_Y = 33, OUT_G = 25;   // exit light
const int PIN_BUZZER = 18;                      // P18, LOW = beep

// ---------- Weighing settings ----------
const float CAL_FACTOR  = 15.53f;  // your calibration value (raw counts per gram)
const int   N           = 10;      // readings averaged (~1 second)
const float STEADY_G    = 15;      // all readings within +-15 g = steady
const float ZERO_G      = 20;      // below this is sent as 0
const float EMPTY_G     = 50;      // below this the platform is empty
const float TRUCK_MIN_G = 150;     // above this a truck is on the platform
const int   TARE_N      = 20;      // readings for a full zero
const int   AUTO_TARE_N = 5;       // readings for the small automatic zero

// ---------- Tamper settings ----------
const long  SAT_RAW      = 8300000;   // raw at HX711 limit = a cell wire is open
const float NEG_LIMIT_G  = -500;      // impossible negative weight = wire shorted
const int   STUCK_COUNT  = 15;        // same raw value this many times = stuck
const unsigned long NO_DATA_MS     = 1000;  // HX711 silent this long = DT/SCK/power cut
const unsigned long CONFIRM_MS     = 300;   // fault must last this long -> alarm
const unsigned long CLEAR_MS       = 3000;  // healthy this long -> alarm stops
const unsigned long BOOT_GRACE_MS  = 2000;  // time for the HX711 to start

// ---------- Server messages ----------
const unsigned long SEND_EVERY_MS   = 200;   // weight
const unsigned long HEARTBEAT_MS    = 5000;  // heartbeat
const unsigned long QUIET_MS        = 1000;  // nothing sent this long -> heartbeat at once
const unsigned long TAMPER_EVERY_MS = 1000;  // the alarm is repeated while it lasts
const unsigned long RECONNECT_MIN_MS = 1000;
const unsigned long RECONNECT_MAX_MS = 15000;
const unsigned long WIFI_RETRY_MS    = 15000;

HX711 scale;
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
bool oledFound = false;
WebSocketsClient webSocket;
Ticker outputTimer;

// ---------- Weighing state ----------
float buf[N]; int bi = 0; bool bfull = false;
float avgG = 0; bool steady = false;
long prevRaw = 0, lastRaw = 0; int sameCount = 0;
unsigned long lastDataMs = 0, bootMs = 0;
bool tared = false;               // the zero has been taken at least once
int tareLeft = 0, tareCount = 0;  // a zero being taken, without blocking
long long tareSum = 0;
unsigned long zeroSince = 0, lastZero = 0, faultSince = 0, okSince = 0;

// ---------- What the outputs show (read by the 20 ms output timer) ----------
volatile bool tamperActive = false;
volatile bool online = false;          // connected to the backend
volatile char positioning = 0;         // 0, 'F' (move forward) or 'B' (move back)
volatile char serverEntry = 'R', serverExit = 'R';
volatile bool serverBlink = false;
volatile unsigned long beepStart = 0, beepOn = 0, beepGap = 0;
volatile int beepCount = 0;

const char* tamperReason = "";
String serverLines[3];

// ---------- Connection state ----------
bool secureServer = false;
String serverHost;
uint16_t serverPort = 80;
unsigned long connectedAt = 0, lastSent = 0, lastWeightSent = 0, lastHeartbeat = 0;
unsigned long lastTamperSent = 0, lastBackoff = 0, reconnectMs = RECONNECT_MIN_MS;
unsigned long lastWifiTry = 0;
int shortConnections = 0;  // connected and dropped at once: usually a wrong token

// ---------- Helpers ----------
bool entryBlocked() { return digitalRead(PIN_IR_ENTRY) == LOW; }
bool exitBlocked()  { return digitalRead(PIN_IR_EXIT)  == LOW; }

void setLight(int r, int y, int g, char c) {
  digitalWrite(r, c == 'R'); digitalWrite(y, c == 'Y'); digitalWrite(g, c == 'G');
}

// Beeps `count` times without stopping the program.
void beep(unsigned long onMs, int count, unsigned long gapMs) {
  beepCount = 0;
  beepStart = millis(); beepOn = onMs; beepGap = gapMs;
  beepCount = count;
}

// Lights and buzzer. Runs every 20 ms from a timer, so a slow reconnect never freezes
// a blinking light or the tamper alarm.
void updateOutputs() {
  unsigned long now = millis();

  if (tamperActive) {                          // the alarm wins over everything
    bool on = (now / 250) % 2;
    digitalWrite(PIN_BUZZER, on ? LOW : HIGH);
    setLight(IN_R, IN_Y, IN_G, on ? 'R' : 'Y');
    setLight(OUT_R, OUT_Y, OUT_G, on ? 'R' : 'Y');
    return;
  }

  bool sound = false;
  if (beepCount > 0) {
    unsigned long period = beepOn + beepGap, since = now - beepStart;
    if (since >= period * beepCount) beepCount = 0;
    else sound = (since % period) < beepOn;
  }
  digitalWrite(PIN_BUZZER, sound ? LOW : HIGH);

  char entry = 'R', exitLamp = 'R';            // offline: both red
  if (online) {
    if (positioning == 'F') entry = 'Y';
    else if (positioning == 'B') exitLamp = 'Y';
    else {
      bool dark = serverBlink && ((now / 500) % 2);
      entry = dark ? 'O' : serverEntry;
      exitLamp = dark ? 'O' : serverExit;
    }
  }
  setLight(IN_R, IN_Y, IN_G, entry);
  setLight(OUT_R, OUT_Y, OUT_G, exitLamp);
}

// Top line small, middle line large (small if it does not fit), bottom line small.
void show(const String& title, const String& big, const String& foot) {
  static String lastScreen;
  String key = title + "|" + big + "|" + foot;
  if (!oledFound || key == lastScreen) return;
  lastScreen = key;
  oled.clearDisplay();
  oled.setTextSize(1); oled.setCursor(0, 0); oled.print(title);
  oled.setTextSize(big.length() <= 10 ? 2 : 1); oled.setCursor(0, 22); oled.print(big);
  oled.setTextSize(1); oled.setCursor(0, 54); oled.print(foot);
  oled.display();
}

void resetBuffer() { bi = 0; bfull = false; steady = false; }

// Takes a new zero from the next `n` readings, without stopping the program.
void startTare(int n) { tareLeft = n; tareCount = n; tareSum = 0; }

void readScale() {
  if (!scale.is_ready()) return;
  long raw = scale.read();
  lastDataMs = millis();
  sameCount = (raw == prevRaw) ? sameCount + 1 : 0;
  prevRaw = raw; lastRaw = raw;

  if (tareLeft > 0) {
    tareSum += raw;
    if (--tareLeft == 0) {
      scale.set_offset((long)(tareSum / tareCount));
      tared = true;
      resetBuffer();
      Serial.println("Zero taken");
    }
    return;
  }

  buf[bi] = (raw - scale.get_offset()) / scale.get_scale();
  bi = (bi + 1) % N; if (bi == 0) bfull = true;
  int n = bfull ? N : bi;
  if (n == 0) return;
  float s = 0, mn = 1e9, mx = -1e9;
  for (int i = 0; i < n; i++) { s += buf[i]; mn = min(mn, buf[i]); mx = max(mx, buf[i]); }
  avgG = s / n;
  steady = bfull && (mx - mn) <= 2 * STEADY_G;
}

// Grams to send: 0 near zero, otherwise to one decimal place. (No rounding to 10 g: the
// backend needs the real figure to compare the cargo with the bill.)
float sentGrams() {
  if (fabs(avgG) < ZERO_G) return 0;
  return roundf(avgG * 10) / 10.0f;
}

// Returns a reason if the load-cell wiring looks tampered, otherwise nullptr
const char* checkFault(unsigned long now) {
  if (now - bootMs < BOOT_GRACE_MS)               return nullptr;
  if (now - lastDataMs > NO_DATA_MS)              return "HX711 NO DATA";
  if (lastRaw >= SAT_RAW || lastRaw <= -SAT_RAW)  return "CELL WIRE OPEN";
  if (sameCount >= STUCK_COUNT)                   return "HX711 STUCK";
  if (bfull && avgG < NEG_LIMIT_G)                return "CELL WIRE FAULT";
  return nullptr;
}

void autoZero(unsigned long now) {
  if (steady && fabs(avgG) < 30 && fabs(avgG) > 3) {
    if (!zeroSince) zeroSince = now;
    if (now - zeroSince > 3000 && now - lastZero > 10000) {
      startTare(AUTO_TARE_N); lastZero = now; zeroSince = 0;
      Serial.println("Auto-zero");
    }
  } else zeroSince = 0;
}

// ---------- Messages to the backend ----------
void sendJson(JsonDocument& doc) {
  if (!online) return;
  String text;
  serializeJson(doc, text);
  webSocket.sendTXT(text);
  lastSent = millis();
}

void sendHeartbeat() {
  JsonDocument doc;
  doc["t"] = "hb";
  sendJson(doc);
  lastHeartbeat = millis();
}

// Whether the wiring is healthy: sent after connecting, when it changes, and repeated
// while the alarm lasts.
void sendWiringState() {
  JsonDocument doc;
  doc["t"] = tamperActive ? "tamper" : "tamper_clear";
  if (tamperActive) doc["reason"] = tamperReason;
  sendJson(doc);
  lastTamperSent = millis();
}

void sendWeight() {
  JsonDocument doc;
  doc["t"] = "w";
  doc["g"] = serialized(String(sentGrams(), 1));
  doc["stable"] = steady;
  doc["pos"] = entryBlocked() ? "forward" : exitBlocked() ? "back" : "ok";
  sendJson(doc);
  lastWeightSent = millis();
}

// ---------- Commands from the backend ----------
char lightOf(const char* text) {
  if (!text) return 'R';
  if (!strcmp(text, "off")) return 'O';
  return text[0];  // "R", "Y" or "G"
}

void handleCommand(const uint8_t* payload, size_t length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.println("A command that is not JSON");
    return;
  }
  const char* type = doc["t"] | "";
  Serial.printf("<- %.*s\n", (int)length, (const char*)payload);

  if (!strcmp(type, "light")) {
    serverEntry = lightOf(doc["entry"]);
    serverExit = lightOf(doc["exit"]);
    serverBlink = doc["blink"] | false;
  } else if (!strcmp(type, "buzz")) {
    beep(constrain((long)(doc["ms"] | 200), 1L, 10000L),
         constrain((int)(doc["times"] | 1), 1, 10),
         constrain((long)(doc["gap"] | 120), 0L, 2000L));
  } else if (!strcmp(type, "display")) {
    JsonArray lines = doc["lines"];
    for (int i = 0; i < 3; i++) serverLines[i] = "";
    if (lines.size() == 1) serverLines[1] = (const char*)(lines[0] | "");
    else for (int i = 0; i < 3 && i < (int)lines.size(); i++)
      serverLines[i] = (const char*)(lines[i] | "");
  } else if (!strcmp(type, "tare")) {
    // Only with an empty platform, whatever the server believes.
    if (!tamperActive && !entryBlocked() && !exitBlocked() && fabs(avgG) < TRUCK_MIN_G)
      startTare(TARE_N);
    else Serial.println("Tare refused: the platform is not empty");
  }
}

void clearServerScreen() {
  serverEntry = 'R'; serverExit = 'R'; serverBlink = false;
  serverLines[0] = "TRINETRA"; serverLines[1] = "CONNECTED"; serverLines[2] = "Please wait";
}

void onWebSocket(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("Server connected");
      clearServerScreen();
      online = true;
      connectedAt = millis();
      sendWiringState();
      sendHeartbeat();
      break;
    case WStype_DISCONNECTED:
      if (online) {
        Serial.println("Server connection lost");
        if (millis() - connectedAt < 3000) {
          if (++shortConnections >= 2)
            Serial.println("The server closes at once: check DEVICE_TOKEN in secrets.h");
        } else shortConnections = 0;
      }
      online = false;
      break;
    case WStype_TEXT:
      handleCommand(payload, length);
      break;
    default:
      break;
  }
}

// "http://192.168.43.20:4000" or "https://name.up.railway.app"
bool parseServerUrl(String url) {
  url.trim();
  if (url.startsWith("https://")) { secureServer = true; url.remove(0, 8); serverPort = 443; }
  else if (url.startsWith("http://")) { secureServer = false; url.remove(0, 7); serverPort = 80; }
  else return false;
  int slash = url.indexOf('/');
  if (slash >= 0) url.remove(slash);
  int colon = url.indexOf(':');
  if (colon >= 0) {
    serverPort = url.substring(colon + 1).toInt();
    url.remove(colon);
  }
  serverHost = url;
  return serverHost.length() > 0 && serverPort > 0;
}

void startServerConnection() {
  static String header = String("x-device-token: ") + DEVICE_TOKEN;
  if (!parseServerUrl(SERVER_URL)) {
    Serial.println("SERVER_URL in secrets.h must start with http:// or https://");
    return;
  }
  Serial.printf("Server: %s://%s:%u/device\n", secureServer ? "wss" : "ws",
                serverHost.c_str(), serverPort);
  webSocket.setExtraHeaders(header.c_str());
  // wss:// is encrypted. The server's certificate is not checked (docs/DECISIONS.md).
  if (secureServer) webSocket.beginSSL(serverHost.c_str(), serverPort, "/device");
  else webSocket.begin(serverHost.c_str(), serverPort, "/device");
  webSocket.onEvent(onWebSocket);
  webSocket.setReconnectInterval(RECONNECT_MIN_MS);
  // A ping every 3 s: a dead hotspot is noticed within seconds.
  webSocket.enableHeartbeat(3000, 2000, 2);
}

// Waits longer and longer between tries: 1 s, 2 s, 4 s ... 15 s.
void backOff(unsigned long now) {
  if (online) {
    if (now - connectedAt > 5000 && reconnectMs != RECONNECT_MIN_MS) {
      reconnectMs = RECONNECT_MIN_MS;
      webSocket.setReconnectInterval(reconnectMs);
    }
    lastBackoff = now;
  } else if (now - lastBackoff > reconnectMs + 1000 && reconnectMs < RECONNECT_MAX_MS) {
    reconnectMs = min(reconnectMs * 2, RECONNECT_MAX_MS);
    webSocket.setReconnectInterval(reconnectMs);
    lastBackoff = now;
  }
}

void keepWifi(unsigned long now) {
  static bool wasConnected = false;
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected != wasConnected) {
    wasConnected = connected;
    if (connected) Serial.printf("Wi-Fi connected, IP %s\n", WiFi.localIP().toString().c_str());
    else {
      Serial.println("Wi-Fi lost");
      // The socket must be opened afresh when Wi-Fi is back, or the library would think
      // it still has one.
      webSocket.disconnect();
      online = false;
    }
  }
  if (!connected) {
    if (now - lastWifiTry > WIFI_RETRY_MS) {
      lastWifiTry = now;
      Serial.printf("Joining Wi-Fi \"%s\" ...\n", WIFI_SSID);
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}

// ---------- Tamper watch: runs all the time, with or without a server ----------
void watchTamper(unsigned long now) {
  const char* fault = checkFault(now);
  if (fault) {
    okSince = 0;
    if (!faultSince) faultSince = now;
    if (!tamperActive && now - faultSince >= CONFIRM_MS) {
      tamperReason = fault;
      tamperActive = true;
      tareLeft = 0;
      Serial.printf("!!! TAMPER: %s\n", fault);
      sendWiringState();
    }
    return;
  }
  faultSince = 0;
  if (!tamperActive) return;
  if (!okSince) okSince = now;
  if (now - okSince <= CLEAR_MS) return;

  tamperActive = false;
  okSince = 0;
  beepCount = 0;
  // A new zero only if the platform is really empty. With something on it, the old zero is
  // kept: zeroing a loaded platform would make every later weight wrong.
  if (!tared || (!entryBlocked() && !exitBlocked() && fabs(avgG) < EMPTY_G)) {
    Serial.println("Wiring OK again - re-zeroing");
    startTare(TARE_N);
  } else {
    Serial.println("Wiring OK again - platform not empty, keeping the old zero");
  }
  sendWiringState();
}

// ---------- What the OLED shows ----------
void updateDisplay(unsigned long now) {
  static unsigned long last = 0;
  if (now - last < 200) return;
  last = now;

  if (tamperActive) show("!!! TAMPER ALERT !!!", "WIRES", tamperReason);
  else if (!tared) show("TRINETRA", "STARTING", "Keep platform empty");
  else if (!online) {
    const char* why = WiFi.status() != WL_CONNECTED ? "No Wi-Fi"
                      : shortConnections >= 2       ? "Check DEVICE_TOKEN"
                                                    : "No server";
    show(why, "OFFLINE", "- do not drive on");
  }
  else if (tareLeft > 0 && tareCount == TARE_N) show("TRINETRA", "RE-ZERO", "Keep platform empty");
  else if (positioning) {
    show("POSITION TRUCK", String((long)roundf(avgG)) + " g",
         positioning == 'F' ? "Move FORWARD" : "Move BACK");
  }
  else show(serverLines[0], serverLines[1], serverLines[2]);
}

// ---------- Setup ----------
void setup() {
  Serial.begin(115200);
  Serial.println("\nTrinetra weighbridge");
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, HIGH);
  int outs[] = { IN_R, IN_Y, IN_G, OUT_R, OUT_Y, OUT_G };
  for (int p : outs) pinMode(p, OUTPUT);
  setLight(IN_R, IN_Y, IN_G, 'R'); setLight(OUT_R, OUT_Y, OUT_G, 'R');
  pinMode(PIN_IR_ENTRY, INPUT);
  pinMode(PIN_IR_EXIT, INPUT);

  Wire.begin(21, 22);
  oledFound = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!oledFound) Serial.println("OLED not found");
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextWrap(false);
  show("TRINETRA", "STARTING", "Keep platform empty");

  scale.begin(PIN_HX_DT, PIN_HX_SCK);
  scale.set_scale(CAL_FACTOR);
  bootMs = millis();
  lastDataMs = bootMs;
  startTare(TARE_N);               // finished by readScale() in the loop
  outputTimer.attach_ms(20, updateOutputs);

  clearServerScreen();
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  Serial.printf("Joining Wi-Fi \"%s\" ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiTry = millis();
  startServerConnection();
}

// ---------- Main loop ----------
void loop() {
  readScale();                     // before anything that may take long
  unsigned long now = millis();
  watchTamper(now);

  bool inB = entryBlocked(), outB = exitBlocked();

  // Yellow and "Move FORWARD / BACK" while a truck is on the platform but over a sensor.
  // Not while the server lets it drive off: it must cross the exit sensor then.
  if (online && !tamperActive && tared && serverExit != 'G' && avgG > TRUCK_MIN_G && (inB || outB))
    positioning = inB ? 'F' : 'B';
  else
    positioning = 0;

  // One short beep as a truck reaches the entry sensor.
  static bool wasAtEntry = false;
  if (inB && !wasAtEntry && avgG < EMPTY_G && !tamperActive && online) beep(120, 1, 120);
  wasAtEntry = inB;

  if (tared && !tamperActive && tareLeft == 0 && !inB && !outB) autoZero(now);

  keepWifi(now);
  if (WiFi.status() == WL_CONNECTED && serverHost.length() > 0) {
    webSocket.loop();              // may block for a few seconds while the server is away
    backOff(millis());
  }

  now = millis();
  if (online) {
    if (tamperActive) {
      // Nothing is weighed during an alarm.
      if (now - lastTamperSent >= TAMPER_EVERY_MS) sendWiringState();
    } else if (tared && bfull && tareLeft == 0 && now - lastWeightSent >= SEND_EVERY_MS) {
      sendWeight();
    }
    // Also at once whenever nothing else is being sent, as while a zero is taken: the
    // server calls the board offline after 3 s of silence.
    if (now - lastHeartbeat >= HEARTBEAT_MS || now - lastSent >= QUIET_MS) sendHeartbeat();
  }
  updateDisplay(now);

  // For calibration and fault finding: one line a second.
  static unsigned long lastPrint = 0;
  if (now - lastPrint >= 1000) {
    lastPrint = now;
    Serial.printf("weight %.1f g  raw %ld  zero %ld  %s  entry %s  exit %s  %s\n",
                  avgG, lastRaw, scale.get_offset(), steady ? "steady" : "moving",
                  inB ? "BLOCKED" : "clear", outB ? "BLOCKED" : "clear",
                  online ? "online" : "OFFLINE");
  }
  // Type t and Enter in the Serial Monitor to zero the empty platform.
  while (Serial.available()) {
    if (Serial.read() == 't') {
      Serial.println("Zeroing: keep the platform empty");
      startTare(TARE_N);
    }
  }
  delay(2);                        // lets the Wi-Fi stack run; not a wait for anything
}
