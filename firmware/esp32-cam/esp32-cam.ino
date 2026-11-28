// Trinetra Systems - ESP32-CAM node
// Board: AI Thinker ESP32-CAM (programmed with the ESP32-CAM-MB burner)
// Works on its own: NOT connected to the main ESP32.
// Joins Wi-Fi and sends its newest picture to the Trinetra backend every 1.5 seconds:
//   POST <SERVER_URL>/api/cam/<CAM_NAME>   header x-device-token, body: the JPEG
// The backend keeps only the newest picture in memory. It saves one, and reads the number
// plate, only when a truck is being weighed.
// The sensor has no hardware JPEG, so it captures RGB565 and converts with frame2jpg().
//
// ONE sketch for BOTH cameras. In secrets.h set CAM_NAME to "front", flash one camera,
// change it to "back", and flash the other. See docs/HARDWARE.md.

#include "esp_camera.h"
#include "img_converters.h"
#include <WiFi.h>
#include <NetworkClientSecure.h>
#include <HTTPClient.h>

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "secrets.h is missing: copy secrets.example.h to secrets.h and fill it in."
#endif

const unsigned long INTERVAL_MS = 1500;   // one picture every 1.5 s
const int JPEG_QUALITY = 70;              // 1-100, higher = better quality
const unsigned long WIFI_RETRY_MS = 15000;
const int RESTART_AFTER_CAPTURE_FAILURES = 10;

// ---------- AI Thinker ESP32-CAM pins (fixed) ----------
#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22
#define FLASH_LED       4

WiFiClient plainClient;
NetworkClientSecure secureClient;
HTTPClient http;

String uploadUrl;
const char* token = nullptr;
unsigned long lastWifiTry = 0;
int captureFailures = 0;

// Stops here with a message every few seconds: the settings need fixing.
void halt(const char* message) {
  for (;;) {
    Serial.println(message);
    delay(3000);
  }
}

void joinWifi() {
  lastWifiTry = millis();
  Serial.printf("Joining Wi-Fi \"%s\" ...\n", WIFI_SSID);
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED, OUTPUT);
  digitalWrite(FLASH_LED, LOW);                // keep the bright flash LED off
  Serial.printf("\nTrinetra camera: %s\n", CAM_NAME);

  if (strcmp(CAM_NAME, "front") == 0) token = CAM_FRONT_TOKEN;
  else if (strcmp(CAM_NAME, "back") == 0) token = CAM_BACK_TOKEN;
  else halt("CAM_NAME in secrets.h must be \"front\" or \"back\"");

  String server = SERVER_URL;
  if (!server.startsWith("http://") && !server.startsWith("https://"))
    halt("SERVER_URL in secrets.h must start with http:// or https://");
  while (server.endsWith("/")) server.remove(server.length() - 1);
  uploadUrl = server + "/api/cam/" + CAM_NAME;

  camera_config_t config = {};
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk  = XCLK_GPIO_NUM;
  config.pin_pclk  = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href  = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn  = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_RGB565;      // sensor has no hardware JPEG
  config.fb_count     = 1;
  config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  if (psramFound()) { config.frame_size = FRAMESIZE_VGA;  config.fb_location = CAMERA_FB_IN_PSRAM; }
  else {
    Serial.println("No PSRAM: small pictures. Turn on PSRAM in the Tools menu.");
    config.frame_size = FRAMESIZE_QVGA; config.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed 0x%x - restarting\n", err);
    delay(3000);
    ESP.restart();
  }
  Serial.println("Camera OK");

  // https:// is encrypted. The server's certificate is not checked (docs/DECISIONS.md).
  secureClient.setInsecure();
  http.setReuse(true);                         // one connection for many pictures

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  joinWifi();
  Serial.printf("Sending to %s\n", uploadUrl.c_str());
}

void upload(uint8_t* jpg, size_t length) {
  bool secure = uploadUrl.startsWith("https://");
  bool started = secure ? http.begin(secureClient, uploadUrl) : http.begin(plainClient, uploadUrl);
  if (!started) { Serial.println("Bad SERVER_URL"); return; }
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("x-device-token", token);
  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  int code = http.POST(jpg, length);
  http.end();

  // 204 is success. Only changes are printed, and a line every 20th picture.
  static int lastCode = 0, sent = 0;
  if (code != lastCode || ++sent % 20 == 0) {
    Serial.printf("Sent %u bytes -> %d%s\n", (unsigned)length, code,
                  code == 204 ? " (OK)"
                  : code == 401 ? " (wrong token)"
                  : code == 403 ? " (this token belongs to another board)"
                  : code < 0    ? " (cannot reach the server)"
                                : "");
    lastCode = code;
  }
}

void loop() {
  static unsigned long last = 0;
  if (millis() - last < INTERVAL_MS) { delay(10); return; }
  last = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiTry > WIFI_RETRY_MS) joinWifi();
    return;
  }
  static bool announced = false;
  if (!announced) {
    announced = true;
    Serial.printf("Connected, camera IP: %s, name: %s\n",
                  WiFi.localIP().toString().c_str(), CAM_NAME);
  }

  camera_fb_t* fb = esp_camera_fb_get();       // throw away an old frame
  if (fb) esp_camera_fb_return(fb);
  fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Capture failed");
    if (++captureFailures >= RESTART_AFTER_CAPTURE_FAILURES) ESP.restart();
    return;
  }
  captureFailures = 0;

  uint8_t* jpg = NULL;
  size_t jpgLen = 0;
  bool ok = frame2jpg(fb, JPEG_QUALITY, &jpg, &jpgLen);   // software RGB565 -> JPEG
  esp_camera_fb_return(fb);
  if (!ok || !jpg) { Serial.println("JPEG convert failed"); return; }

  upload(jpg, jpgLen);
  free(jpg);
}
