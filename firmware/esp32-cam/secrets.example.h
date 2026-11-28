// Copy this file to secrets.h (same folder) and fill in your own values.
// secrets.h is never committed to Git. Do not put real values in this example file.
#pragma once

// Which camera you are flashing now: "front" or "back". This is the only line you change
// between the two cameras.
#define CAM_NAME "front"

// Your phone hotspot. It must be 2.4 GHz.
#define WIFI_SSID     "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// The Trinetra backend, with no slash at the end.
//   On your laptop (pnpm dev or pnpm lan):  "http://<laptop IPv4 address>:4000"
//   After deploying:                        "https://<your-app>.up.railway.app"
#define SERVER_URL "http://192.168.1.100:4000"

// The same values as in apps/server/.env (or on Railway). Fill in both: the sketch uses
// the one that matches CAM_NAME.
#define CAM_FRONT_TOKEN "PASTE_CAM_FRONT_TOKEN_HERE"
#define CAM_BACK_TOKEN  "PASTE_CAM_BACK_TOKEN_HERE"
