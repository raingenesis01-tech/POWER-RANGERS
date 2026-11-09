// Classroom presence node.
// Reads a digital presence sensor and publishes two Blynk virtual pins:
//   V0 = 1 when a person is present, 0 when the room is clear
//   V1 = heartbeat that increases on every successful publish
// The website treats a stopped heartbeat as Sensor offline. It does not
// treat a missing update as an empty room.

#include "secrets.h"

#define BLYNK_PRINT Serial
#include <WiFi.h>
#include <BlynkSimpleEsp32.h>

#ifndef SENSOR_PIN
#define SENSOR_PIN 27
#endif
#ifndef SENSOR_ACTIVE_HIGH
#define SENSOR_ACTIVE_HIGH 1
#endif

// A reading must stay the same this long before it is accepted.
const unsigned long CONFIRM_MS = 2000;
// V0 and V1 are sent again at this interval while the state is unchanged.
const unsigned long PUBLISH_MS = 10000;
const unsigned long RECONNECT_MS = 15000;

bool candidatePresent = false;
bool stablePresent = false;
bool haveCandidate = false;
bool haveStable = false;
unsigned long candidateSince = 0;
unsigned long lastPublish = 0;
unsigned long lastReconnect = 0;
uint32_t heartbeat = 0;

bool readPresent() {
  int level = digitalRead(SENSOR_PIN);
  if (SENSOR_ACTIVE_HIGH) {
    return level == HIGH;
  }
  return level == LOW;
}

void connectNetwork() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Connecting to Wi-Fi...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
      delay(400);
      Serial.print(".");
    }
    Serial.println();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Wi-Fi did not connect. Check WIFI_SSID and WIFI_PASSWORD in secrets.h.");
      return;
    }
    Serial.print("Wi-Fi connected. IP address: ");
    Serial.println(WiFi.localIP());
  }

  if (!Blynk.connected()) {
    Serial.println("Connecting to Blynk...");
    Blynk.config(BLYNK_AUTH_TOKEN);
    if (Blynk.connect(12000)) {
      Serial.println("Blynk connected.");
    } else {
      Serial.println("Blynk did not connect. Check the template ID, device token, and internet access.");
    }
  }
}

void publishPresence() {
  if (!haveStable) {
    return;
  }
  if (!Blynk.connected()) {
    Serial.println("Not published: Blynk is disconnected. The website should show Sensor offline.");
    return;
  }
  heartbeat++;
  Blynk.virtualWrite(V0, stablePresent ? 1 : 0);
  Blynk.virtualWrite(V1, heartbeat);
  lastPublish = millis();
  Serial.print("Published presence=");
  Serial.print(stablePresent ? 1 : 0);
  Serial.print(" heartbeat=");
  Serial.println(heartbeat);
}

void updatePresence() {
  bool raw = readPresent();
  unsigned long now = millis();
  if (!haveCandidate || raw != candidatePresent) {
    candidatePresent = raw;
    candidateSince = now;
    haveCandidate = true;
  }
  if (!haveStable || stablePresent != candidatePresent) {
    if (now - candidateSince >= CONFIRM_MS) {
      stablePresent = candidatePresent;
      haveStable = true;
      Serial.println(stablePresent ? "SERIAL presence=1" : "SERIAL presence=0");
      publishPresence();
    }
    return;
  }
  if (now - lastPublish >= PUBLISH_MS) {
    publishPresence();
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  pinMode(SENSOR_PIN, INPUT);
  Serial.println();
  Serial.println("Classroom occupancy node");
  Serial.println("If this is a PIR sensor, wait about 60 seconds before recording trials.");
  Serial.println("An LD2410 can be checked after it powers up and Blynk connects.");
  if (String(BLYNK_AUTH_TOKEN).startsWith("PASTE")) {
    Serial.println("Replace BLYNK_AUTH_TOKEN in secrets.h before expecting cloud updates.");
  }
  connectNetwork();
  candidatePresent = readPresent();
  candidateSince = millis();
  haveCandidate = true;
}

void loop() {
  updatePresence();
  if (WiFi.status() != WL_CONNECTED || !Blynk.connected()) {
    unsigned long now = millis();
    if (now - lastReconnect >= RECONNECT_MS) {
      lastReconnect = now;
      connectNetwork();
    }
  } else {
    Blynk.run();
  }
}
