// Trinetra Systems - ESP32-CAM node
// Board: AI Thinker ESP32-CAM (programmed with ESP32-CAM-MB burner)
// Works on its own: NOT connected to the main ESP32.
// Joins Wi-Fi and uploads a JPEG to the server every 2 seconds:
//   POST <SERVER>/api/cam/<CAM_NAME>   (Content-Type: image/jpeg)
// The sensor has no hardware JPEG, so it captures RGB565 and converts with frame2jpg().
// Flash this sketch twice: CAM_NAME "entry" on one module, "exit" on the other.

#include "esp_camera.h"
#include "img_converters.h"
#include <WiFi.h>
#include <HTTPClient.h>

// ---------- Change these ----------
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
const char* SERVER    = "http://YOUR_SERVER_ADDRESS:3000";   // server address (laptop IPv4 or deployed URL)
const char* CAM_NAME  = "exit";                      // second camera: "exit"
const unsigned long INTERVAL_MS = 2000;               // upload every 2 s
const int JPEG_QUALITY = 70;                          // 1-100, higher = better quality

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

void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED, OUTPUT);
  digitalWrite(FLASH_LED, LOW);                // keep the bright flash LED off

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
  else              { config.frame_size = FRAMESIZE_QVGA; config.fb_location = CAMERA_FB_IN_DRAM; }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed 0x%x - restarting\n", err);
    delay(3000);
    ESP.restart();
  }
  Serial.println("Camera OK");

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\nConnected, camera IP: %s, name: %s\n", WiFi.localIP().toString().c_str(), CAM_NAME);
}

void loop() {
  static unsigned long last = 0;
  if (millis() - last < INTERVAL_MS) { delay(10); return; }
  last = millis();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi lost, reconnecting");
    WiFi.reconnect();
    return;
  }

  camera_fb_t* fb = esp_camera_fb_get();       // throw away an old frame
  if (fb) esp_camera_fb_return(fb);
  fb = esp_camera_fb_get();
  if (!fb) { Serial.println("Capture failed"); return; }

  uint8_t* jpg = NULL;
  size_t jpgLen = 0;
  bool ok = frame2jpg(fb, JPEG_QUALITY, &jpg, &jpgLen);   // software RGB565 -> JPEG
  esp_camera_fb_return(fb);
  if (!ok || !jpg) { Serial.println("JPEG convert failed"); return; }

  HTTPClient http;
  http.begin(String(SERVER) + "/api/cam/" + CAM_NAME);
  http.addHeader("Content-Type", "image/jpeg");
  http.setTimeout(5000);
  int code = http.POST(jpg, jpgLen);
  http.end();
  free(jpg);

  Serial.printf("Sent %u bytes -> %d\n", (unsigned)jpgLen, code);
}