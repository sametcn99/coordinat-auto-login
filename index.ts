import wifi from "node-wifi";
import { execSync } from "child_process";
import os from "os";
import axios from "axios";
import fs from "fs";
import path from "path";

// ========== ⚙️ SETTINGS ==========

// Log levels for more granular logging
enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

class AutoLogin {
  private WIFI_SSID: string; // Wi-Fi network name
  private WIFI_PASSWORD: string; // Wi-Fi password (if needed)
  private AUTH_URL: string; // Captive portal POST URL
  private LOGIN_INTERVAL_MS: number; // Check every 10 seconds
  private LOG_FILE: string;
  private FORM_DATA: {
    TC_NU: string;
    NAME: string;
    SURNAME: string;
    BIRTH_YEAR: string;
  };
  private connectionAttempts: number = 0;
  private successfulConnections: number = 0;
  private lastSuccessTime: number = Date.now();
  private consecutiveActiveConnections: number = 0;
  private silentMode: boolean = false;

  constructor() {
    this.WIFI_SSID = process.env.WIFI_SSID || "COORDINAT";
    this.WIFI_PASSWORD = process.env.WIFI_PASSWORD || "";
    this.AUTH_URL =
      process.env.AUTH_URL || "http://192.168.1.44:5000/Hotspot/Authentication";
    this.LOGIN_INTERVAL_MS = process.env.LOGIN_INTERVAL_MS
      ? parseInt(process.env.LOGIN_INTERVAL_MS)
      : 5_000; // 5 seconds
    this.LOG_FILE = path.join(__dirname, "connection.log");
    this.FORM_DATA = {
      TC_NU: process.env.TC_NO || "12345678901", // National ID Number
      NAME: process.env.NAME || "YourName", // First Name
      SURNAME: process.env.SURNAME || "YourSurname", // Last Name
      BIRTH_YEAR: process.env.BIRTH_YEAR || "2000", // Birth Year
    };
  }
  // Function to log messages both to console and file with enhanced details
  private log(
    message: string,
    error?: Error | string | unknown,
    level: LogLevel = LogLevel.INFO,
  ) {
    // Skip logging if in silent mode and there's no error
    if (this.silentMode && !error && level === LogLevel.INFO) {
      return;
    }

    // If there's an error, exit silent mode
    if (error) {
      if (this.silentMode) {
        this.silentMode = false;
        this.consecutiveActiveConnections = 0;
        console.log(
          `[${new Date().toISOString()}] ⚠️ Error detected - Exiting silent mode`,
        );
      }
    }

    const timestamp = new Date().toISOString();
    const memoryUsage = process.memoryUsage();
    const memoryInfo = `mem:${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`;
    let logMessage = `[${timestamp}][${level}][${memoryInfo}] ${message}`;

    if (error) {
      const errorDetails =
        error instanceof Error
          ? `\n    Error: ${error.message}\n    Stack: ${error.stack}`
          : `\n    Details: ${typeof error === "object" ? JSON.stringify(error, null, 2) : error}`;
      logMessage += errorDetails;
      console.error(logMessage);
    } else {
      console.log(logMessage);
    }

    // Ensure log directory exists
    try {
      // Add extra newline for better readability between entries if needed
      fs.appendFileSync(this.LOG_FILE, logMessage + "\n");
    } catch (err) {
      console.error(`Failed to write to log file: ${err}`);
    }
  }

  // Get device MAC address
  private getMacAddress(): string | null {
    this.log(`🔍 Getting system MAC address...`, undefined, LogLevel.DEBUG);
    const ifaces = os.networkInterfaces();
    this.log(
      `🖥️ Network interfaces found: ${Object.keys(ifaces).join(", ")}`,
      undefined,
      LogLevel.DEBUG,
    );

    for (const [name, iface] of Object.entries(ifaces)) {
      if (!iface) {
        this.log(
          `⚠️ No interface information for: ${name}`,
          undefined,
          LogLevel.DEBUG,
        );
        continue;
      }

      this.log(
        `📝 Checking interface: ${name} with ${iface.length} address(es)`,
        undefined,
        LogLevel.DEBUG,
      );

      for (const info of iface) {
        this.log(
          `  - Address: ${info.address}, Family: ${info.family}, MAC: ${info.mac}, Internal: ${info.internal}`,
          undefined,
          LogLevel.DEBUG,
        );
        if (
          info.family === "IPv4" &&
          !info.internal &&
          info.mac !== "00:00:00:00:00:00"
        ) {
          this.log(
            `✅ Found valid MAC address: ${info.mac} on interface ${name}`,
            undefined,
            LogLevel.DEBUG,
          );
          return info.mac;
        }
      }
    }

    this.log(
      `❌ Could not find a valid MAC address on any interface`,
      undefined,
      LogLevel.WARN,
    );
    return null;
  }

  // Scan for WiFi networks and get the target network's MAC address
  private async getWifiMacAddress(): Promise<string | null> {
    this.log(
      `🔍 Starting WiFi scan to find network: "${this.WIFI_SSID}"`,
      undefined,
      LogLevel.INFO,
    );
    try {
      const networks = await wifi.scan();
      this.log(
        `📶 Found ${networks.length} WiFi networks in range`,
        undefined,
        LogLevel.DEBUG,
      );

      // Log all networks found (for debugging purposes)
      networks.forEach((network, index) => {
        this.log(
          `  [${index + 1}/${networks.length}] SSID: ${network.ssid || "Unknown"}, BSSID: ${
            network.bssid || "Unknown"
          }, Channel: ${network.channel || "Unknown"}, Signal: ${network.signal_level || "Unknown"}`,
          undefined,
          LogLevel.DEBUG,
        );
      });

      const targetNetwork = networks.find(
        (network) => network.ssid === this.WIFI_SSID,
      );
      if (!targetNetwork) {
        this.log(
          `❌ Network "${this.WIFI_SSID}" not found in scan results`,
          undefined,
          LogLevel.WARN,
        );
        return null;
      }

      this.log(
        `📡 Found target network: ${this.WIFI_SSID} (BSSID: ${targetNetwork.bssid}, Channel: ${targetNetwork.channel}, Signal: ${targetNetwork.signal_level})`,
        undefined,
        LogLevel.INFO,
      );
      return targetNetwork?.bssid || null;
    } catch (err) {
      this.log(`❌ WiFi scanning error`, err, LogLevel.ERROR);
      return null;
    }
  }

  // Connection check (ping)
  private isOnline(): boolean {
    this.log(
      `🌐 Checking internet connectivity (pinging 8.8.8.8)...`,
      undefined,
      LogLevel.DEBUG,
    );
    try {
      const startTime = Date.now();
      execSync("ping -n 1 8.8.8.8", { stdio: "ignore" });
      const responseTime = Date.now() - startTime;
      this.log(
        `✅ Internet connectivity check passed (response time: ${responseTime}ms)`,
        undefined,
        LogLevel.DEBUG,
      );
      return true;
    } catch (err) {
      this.log(
        `❌ Internet connectivity check failed - no response from 8.8.8.8`,
        err,
        LogLevel.WARN,
      );
      return false;
    }
  }

  // Connect to Wi-Fi
  private async connectToWifi() {
    this.log(
      `📶 Initializing WiFi interface for connection...`,
      undefined,
      LogLevel.INFO,
    );
    wifi.init({ iface: null }); // iface: null → auto-detect (Windows)
    try {
      this.log(
        `🔍 Searching for target WiFi network: "${this.WIFI_SSID}"...`,
        undefined,
        LogLevel.INFO,
      );
      const bssid = await this.getWifiMacAddress();
      if (!bssid) {
        const error = new Error(`WiFi network "${this.WIFI_SSID}" not found`);
        this.log(
          `❌ Connection attempt failed: Target network not found`,
          error,
          LogLevel.ERROR,
        );
        throw error;
      }

      this.log(
        `🔌 Attempting connection to "${this.WIFI_SSID}" with${this.WIFI_PASSWORD ? "" : "out"} password...`,
        undefined,
        LogLevel.INFO,
      );
      const connectionStartTime = Date.now();
      await wifi.connect({
        ssid: this.WIFI_SSID,
        password: this.WIFI_PASSWORD,
      });
      const connectionTime = Date.now() - connectionStartTime;

      this.log(
        `📶 Successfully connected to Wi-Fi: ${this.WIFI_SSID} (Network MAC: ${bssid}, Connection time: ${connectionTime}ms)`,
        undefined,
        LogLevel.INFO,
      );
    } catch (err) {
      this.log("❌ Wi-Fi connection error", err, LogLevel.ERROR);
    }
  }

  // Disconnect from current WiFi
  private async disconnectFromWifi() {
    this.log(
      `🔄 Initializing WiFi interface for disconnection...`,
      undefined,
      LogLevel.INFO,
    );
    wifi.init({ iface: null }); // iface: null → auto-detect (Windows)
    try {
      // Get current connection status before disconnection
      this.log(
        `📊 Checking current connection state before disconnection...`,
        undefined,
        LogLevel.DEBUG,
      );
      const currentConnections = await wifi.getCurrentConnections();
      if (currentConnections.length > 0) {
        currentConnections.forEach((conn) => {
          this.log(
            `📡 Currently connected to: SSID: ${conn.ssid || "Unknown"}, MAC: ${conn.mac || "Unknown"}, Channel: ${
              conn.channel || "Unknown"
            }`,
            undefined,
            LogLevel.DEBUG,
          );
        });
      } else {
        this.log(
          `📡 No active WiFi connections detected before disconnection`,
          undefined,
          LogLevel.DEBUG,
        );
      }

      this.log(
        `🔌 Executing disconnection command...`,
        undefined,
        LogLevel.INFO,
      );
      const disconnectStartTime = Date.now();
      await wifi.disconnect();
      const disconnectTime = Date.now() - disconnectStartTime;

      this.log(
        `📡 Successfully disconnected from WiFi network (Operation took: ${disconnectTime}ms)`,
        undefined,
        LogLevel.INFO,
      );
    } catch (err) {
      this.log(`❌ WiFi disconnection error`, err, LogLevel.ERROR);
    }
  }

  // Captive portal login
  private async authenticateToPortal() {
    const mac = this.getMacAddress();
    const form = new URLSearchParams();

    for (const [key, value] of Object.entries(this.FORM_DATA)) {
      form.append(key, value);
    }

    if (mac) {
      form.append("mac", mac);
      this.log(`🔑 Attempting authentication with MAC: ${mac}`);
    } else {
      this.log("⚠️ Warning: Could not determine MAC address");
    }
    try {
      this.log(
        `📡 Sending auth request to ${this.AUTH_URL} with form data: ${JSON.stringify(Object.fromEntries(form))}`,
        undefined,
        LogLevel.INFO,
      );
      const res = await axios.post(this.AUTH_URL, form, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });

      this.log(
        `✅ Portal auth successful (Status: ${res.status}, Data: ${JSON.stringify(res.data)})`,
        undefined,
        LogLevel.INFO,
      );
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const errorDetails = {
          status: err.response?.status,
          statusText: err.response?.statusText,
          responseData: err.response?.data,
          message: err.message || "Unknown error",
          config: {
            url: err.config ? err.config.url : undefined,
            method: err.config ? err.config.method : undefined,
            headers: err.config ? err.config.headers : undefined,
            data: err.config ? err.config.data : undefined,
          },
        };
        this.log(`❌ Portal auth error`, JSON.stringify(errorDetails, null, 2));
      } else {
        this.log(
          `❌ Portal auth error`,
          err instanceof Error ? err : JSON.stringify(err, null, 2),
        );
      }
    }
  }

  // Main loop
  public async monitor() {
    this.log(
      `🚀 Starting Coordinat Auto-Login monitoring service`,
      undefined,
      LogLevel.INFO,
    );
    const cpus = os.cpus();
    const cpuModel =
      cpus.length > 0 && cpus[0]?.model ? cpus[0].model : "Unknown CPU";
    this.log(
      `📊 System Info: ${os.platform()} ${os.arch()}, ${cpuModel}, RAM: ${Math.round(
        os.totalmem() / (1024 * 1024 * 1024),
      )}GB`,
      undefined,
      LogLevel.INFO,
    );
    this.log(
      `⚙️ Settings: WiFi SSID="${this.WIFI_SSID}", Auth URL=${this.AUTH_URL}, Login Interval=${this.LOGIN_INTERVAL_MS}ms`,
      undefined,
      LogLevel.INFO,
    );

    // Initial disconnect
    this.log(
      `🔄 Performing initial WiFi disconnect for a clean start...`,
      undefined,
      LogLevel.INFO,
    );
    await this.disconnectFromWifi();
    while (true) {
      const currentTime = Date.now();
      const uptime = Math.floor((currentTime - this.lastSuccessTime) / 1000);

      if (!this.isOnline()) {
        this.connectionAttempts++;
        // Reset consecutive active connections counter when connection is lost
        this.consecutiveActiveConnections = 0;
        // Exit silent mode if active
        if (this.silentMode) {
          this.silentMode = false;
          this.log(
            `🔊 Connection lost - Exiting silent mode`,
            undefined,
            LogLevel.INFO,
          );
        }

        this.log(
          `🌐 No connection detected (Attempt #${this.connectionAttempts}, Last success: ${uptime}s ago)`,
          undefined,
          LogLevel.INFO,
        );

        // Try to connect
        this.log(
          `🔄 Initiating connection sequence...`,
          undefined,
          LogLevel.INFO,
        );
        await this.connectToWifi();

        this.log(
          `⏳ Waiting 5 seconds for connection to stabilize...`,
          undefined,
          LogLevel.DEBUG,
        );
        await new Promise((res) => setTimeout(res, 5000));

        this.log(
          `🔑 Starting portal authentication process...`,
          undefined,
          LogLevel.INFO,
        );
        await this.authenticateToPortal();

        // Check if we're online after authentication
        if (this.isOnline()) {
          this.successfulConnections++;
          this.lastSuccessTime = Date.now();
          this.log(
            `✅ Connection successfully established (Total successful connections: ${this.successfulConnections})`,
            undefined,
            LogLevel.INFO,
          );
        } else {
          this.log(
            `⚠️ Connection still not available after authentication attempt`,
            undefined,
            LogLevel.WARN,
          );
        }
      } else {
        // Increment consecutive active connections counter
        this.consecutiveActiveConnections++;

        // Enter silent mode if we reach three consecutive active connections
        if (this.consecutiveActiveConnections === 3 && !this.silentMode) {
          this.silentMode = true;
          this.log(
            `🔇 Connection stable for 3 consecutive checks - Entering silent mode`,
            undefined,
            LogLevel.INFO,
          );
        }

        this.log(
          `✅ Connection active (Uptime: ${uptime}s, Success rate: ${(
            (this.successfulConnections /
              Math.max(1, this.connectionAttempts)) *
            100
          ).toFixed(1)}%)`,
          undefined,
          LogLevel.INFO,
        );
      }

      this.log(
        `💤 Sleeping for ${this.LOGIN_INTERVAL_MS / 1000}s before next check...`,
        undefined,
        LogLevel.DEBUG,
      );
      await new Promise((res) => setTimeout(res, this.LOGIN_INTERVAL_MS));
    }
  }
}

// Start
const autoLogin = new AutoLogin();
autoLogin.monitor();
