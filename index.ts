/**
 * @fileoverview Main script for the Coordinat Auto Login application.
 * Handles Wi-Fi connection, captive portal detection, and automatic login.
 */
import axios from "axios";
import * as path from "path";
import * as os from "os"; // Ensure os is imported at the top
import wifi from "node-wifi"; // Import node-wifi
import puppeteer, { Browser, Page } from "puppeteer"; // Add Puppeteer for browser-based authentication
import * as fs from "fs/promises"; // Use fs/promises for async file operations
import inquirer from "inquirer"; // Import inquirer
// import { exec } from 'child_process'; // Keep commented if not used
// import { promisify } from 'util'; // Keep commented if not used
// const execAsync = promisify(exec);

/**
 * Enum representing the different log levels.
 * @enum {string}
 */
enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

/**
 * Enum representing the network connectivity status.
 * @enum {string}
 */
enum ConnectivityStatus {
  ONLINE = "ONLINE",
  OFFLINE = "OFFLINE",
  CAPTIVE_PORTAL = "CAPTIVE_PORTAL",
}

/**
 * Interface defining the structure for the application configuration.
 * @interface AppConfig
 */
interface AppConfig {
  /** The SSID (name) of the target Wi-Fi network. */
  WIFI_SSID: string;
  /** The password for the target Wi-Fi network (optional). */
  WIFI_PASSWORD?: string;
  /** The URL used for captive portal authentication POST requests or initial navigation. */
  AUTH_URL: string;
  /** The interval in milliseconds between connectivity checks. */
  LOGIN_INTERVAL_MS: number;
  /** The user's Turkish ID number (TC Kimlik No). */
  TC_NU: string;
  /** The user's first name. */
  NAME: string;
  /** The user's last name. */
  SURNAME: string;
  /** The user's birth year (YYYY format). */
  BIRTH_YEAR: string;
}

/**
 * @class AutoLogin
 * Manages the process of automatically connecting to a specified Wi-Fi network
 * and handling captive portal authentication.
 */
class AutoLogin {
  /** @private The SSID of the Wi-Fi network to connect to. */
  private WIFI_SSID: string;
  /** @private The password for the Wi-Fi network (if required). */
  private WIFI_PASSWORD: string;
  /** @private The URL used for captive portal authentication or detection. */
  private AUTH_URL: string;
  /** @private The interval in milliseconds for checking connectivity status. */
  private LOGIN_INTERVAL_MS: number;
  /** @private The path to the log file. */
  private LOG_FILE: string;
  /** @private The user data required for the captive portal login form. */
  private FORM_DATA: {
    idnumber: string; // Changed from TC_NU to match Hotspot.html
    name: string; // Changed from NAME
    surname: string; // Changed from SURNAME
    birthyear: string; // Changed from BIRTH_YEAR
  };
  /** @private Counter for connection attempts since the last success. */
  private connectionAttempts: number = 0;
  /** @private Counter for total successful connections. */
  private successfulConnections: number = 0;
  /** @private Timestamp of the last successful connection. */
  private lastSuccessTime: number = Date.now();
  /** @private Counter for consecutive successful connectivity checks. */
  private consecutiveActiveConnections: number = 0;
  /** @private Flag indicating if the script is in silent mode (reduced logging). */
  private silentMode: boolean = false;
  /** @private Holds the Puppeteer browser instance if currently active. */
  private browserInstance: Browser | null = null; // Track browser instance for cleanup
  /** @private Holds the loaded application configuration. */
  private config!: AppConfig; // Add a property to hold the loaded config
  /** @private The absolute path to the configuration file. */
  private configPath: string; // Path to the config file

  /**
   * Creates an instance of AutoLogin.
   * Initializes properties with default values and defines the config path.
   */
  constructor() {
    // Initialize properties with placeholder or default values
    // These will be overwritten by the config loaded in init()
    this.WIFI_SSID = "";
    this.WIFI_PASSWORD = "";
    this.AUTH_URL = "";
    this.LOGIN_INTERVAL_MS = 5000; // Default interval
    this.LOG_FILE = path.join(__dirname, "coordinat-auto-login.log");
    this.FORM_DATA = {
      idnumber: "",
      name: "",
      surname: "",
      birthyear: "",
    };
    this.configPath = path.join(__dirname, "auto-login.config.json"); // Define config file path
  }

  /**
   * Initializes the AutoLogin instance.
   * Loads configuration from a file or prompts the user if the file doesn't exist.
   * Sets up class properties based on the configuration.
   * Initializes the `node-wifi` library.
   * @public
   * @async
   * @returns {Promise<void>} A promise that resolves when initialization is complete.
   */
  public async init(): Promise<void> {
    this.log("🔧 Initializing configuration...", undefined, LogLevel.DEBUG);
    this.config = await this.loadOrPromptConfig();

    // Set class properties from the loaded/prompted config
    this.WIFI_SSID = this.config.WIFI_SSID;
    this.WIFI_PASSWORD = this.config.WIFI_PASSWORD || ""; // Use empty string if undefined
    this.AUTH_URL = this.config.AUTH_URL;
    this.LOGIN_INTERVAL_MS = this.config.LOGIN_INTERVAL_MS || 5000; // Use default if not in config
    this.FORM_DATA = {
      idnumber: this.config.TC_NU,
      name: this.config.NAME,
      surname: this.config.SURNAME,
      birthyear: this.config.BIRTH_YEAR,
    };

    this.log("🔧 Configuration loaded:", this.config, LogLevel.DEBUG);

    // Initialize node-wifi after config is loaded
    wifi.init({
      iface: null, // network interface, choose a random wifi interface if set to null
    });
    this.log("📶 node-wifi initialized.", undefined, LogLevel.DEBUG);
  }

  /**
   * Loads configuration from the `auto-login.config.json` file.
   * If the file doesn't exist, it prompts the user for configuration details
   * using `inquirer` and saves the answers to the file.
   * @private
   * @async
   * @returns {Promise<AppConfig>} A promise that resolves with the loaded or newly created configuration.
   * @throws {Error} If the configuration file exists but is invalid or missing required fields.
   * @throws {Error} If there's an error reading or writing the configuration file (other than ENOENT).
   */
  private async loadOrPromptConfig(): Promise<AppConfig> {
    try {
      this.log(
        `🔍 Checking for configuration file at: ${this.configPath}`,
        undefined,
        LogLevel.DEBUG,
      );
      const data = await fs.readFile(this.configPath, "utf-8");
      this.log(
        "✅ Configuration file found. Loading settings.",
        undefined,
        LogLevel.INFO,
      );
      const parsedConfig = JSON.parse(data) as AppConfig;
      // Basic validation of loaded config (add more checks as needed)
      if (
        !parsedConfig.WIFI_SSID ||
        !parsedConfig.AUTH_URL ||
        !parsedConfig.TC_NU ||
        !parsedConfig.NAME ||
        !parsedConfig.SURNAME ||
        !parsedConfig.BIRTH_YEAR
      ) {
        throw new Error(
          "Configuration file is missing required fields. Please check auto-login.config.json or delete it to re-configure.",
        );
      }
      return parsedConfig;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        this.log(
          "⚠️ Configuration file not found. Prompting user for details...",
          undefined,
          LogLevel.WARN,
        );
        const answers = await inquirer.prompt<AppConfig>([
          {
            type: "input",
            name: "WIFI_SSID",
            message: "Enter the Wi-Fi network name (SSID):",
            default: "COORDINAT",
          },
          {
            type: "password", // Use password type for sensitive info
            name: "WIFI_PASSWORD",
            message: "Enter the Wi-Fi password (leave blank if none):",
            mask: "*",
          },
          {
            type: "input",
            name: "AUTH_URL",
            message: "Enter the captive portal authentication URL:",
            default: "http://www.msftconnecttest.com/redirect", // Provide a common default
          },
          {
            type: "input",
            name: "TC_NU",
            message: "Enter your ID number (TC Kimlik No):",
            validate: (input) =>
              /^\d{11}$/.test(input) ||
              "Please enter a valid 11-digit ID number.",
          },
          {
            type: "input",
            name: "NAME",
            message: "Enter your first name:",
            validate: (input) => input.length > 0 || "Name cannot be empty.",
          },
          {
            type: "input",
            name: "SURNAME",
            message: "Enter your last name:",
            validate: (input) => input.length > 0 || "Surname cannot be empty.",
          },
          {
            type: "input",
            name: "BIRTH_YEAR",
            message: "Enter your birth year (YYYY):",
            validate: (input) =>
              /^\d{4}$/.test(input) || "Please enter a valid 4-digit year.",
          },
          {
            type: "number",
            name: "LOGIN_INTERVAL_MS",
            message: "Enter the check interval in milliseconds:",
            default: 5000,
          },
        ]);

        try {
          await fs.writeFile(
            this.configPath,
            JSON.stringify(answers, null, 2),
            "utf-8",
          );
          this.log(
            `💾 Configuration saved to ${this.configPath}`,
            undefined,
            LogLevel.INFO,
          );
          return answers;
        } catch (writeError) {
          this.log(
            "❌ Error saving configuration file.",
            writeError,
            LogLevel.ERROR,
          );
          // Proceed with the answers even if saving failed, but log the error
          return answers;
        }
      } else {
        this.log("❌ Error reading configuration file.", error, LogLevel.ERROR);
        // Rethrow the error or handle it more gracefully, e.g., exit
        throw new Error(
          `Failed to load or create configuration: ${error.message}`,
        );
      }
    }
  }

  /**
   * Logs a message to both the console and the log file.
   * Includes timestamp, log level, and memory usage.
   * Handles optional error details.
   * Manages silent mode (suppresses INFO logs when stable, exits silent mode on error).
   * Truncates the log file if it exceeds 5MB.
   * @private
   * @param {string} message - The main message to log.
   * @param {Error | string | unknown} [error] - Optional error object or details.
   * @param {LogLevel} [level=LogLevel.INFO] - The severity level of the log message.
   */
  private async log(
    message: string,
    error?: Error | string | unknown,
    level: LogLevel = LogLevel.INFO,
  ): Promise<void> {
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
    }

    // Log to console
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logMessage);
        break;
      case LogLevel.INFO:
        console.info(logMessage);
        break;
      case LogLevel.WARN:
        console.warn(logMessage);
        break;
      case LogLevel.ERROR:
        console.error(logMessage);
        break;
      default:
        console.log(logMessage);
    } // Append to log file with size check and truncation
    try {
      // Check file size
      try {
        const stats = await fs.stat(this.LOG_FILE);
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (stats.size > maxSize) {
          console.warn(
            `[${new Date().toISOString()}][WARN] Log file size (${(stats.size / (1024 * 1024)).toFixed(2)}MB) exceeds 5MB. Truncating...`,
          );
          const content = await fs.readFile(this.LOG_FILE, "utf-8");
          const lines = content.split("\\n");
          if (lines.length > 200) {
            const truncatedContent = lines.slice(200).join("\\n"); // Keep lines after the first 200
            await fs.writeFile(this.LOG_FILE, truncatedContent, "utf-8");
            console.info(
              `[${new Date().toISOString()}][INFO] Log file truncated. Removed first 200 lines.`,
            );
          } else {
            // If less than 200 lines but still > 5MB (unlikely but possible), clear the file
            await fs.writeFile(this.LOG_FILE, "", "utf-8");
            console.warn(
              `[${new Date().toISOString()}][WARN] Log file exceeded 5MB but had less than 200 lines. Cleared file.`,
            );
          }
        }
      } catch (statError: any) {
        if (statError.code !== "ENOENT") {
          // Log error if it's not "file not found" (which is fine on first run)
          console.error(
            `[${new Date().toISOString()}][ERROR] Error checking log file size: ${statError.message}`,
          );
        }
      }

      // Append the new log message
      await fs.appendFile(this.LOG_FILE, logMessage + "\\n");
    } catch (err: any) {
      console.error(
        `[${new Date().toISOString()}][ERROR] Failed to write to log file: ${err.message}`,
      );
    }
  }

  /**
   * Retrieves the MAC address of the first active non-internal IPv4 network interface.
   * @private
   * @returns {string | null} The MAC address string, or null if none is found.
   */
  private getMacAddress(): string | null {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]!) {
        // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        if ("IPv4" !== iface.family || iface.internal !== false) {
          continue;
        }
        // Return the first valid MAC address found
        if (iface.mac && iface.mac !== "00:00:00:00:00:00") {
          return iface.mac;
        }
      }
    }
    return null;
  }

  /**
   * Placeholder function to get the MAC address of the target Wi-Fi network's access point.
   * Note: This is highly OS-dependent and likely requires platform-specific implementations
   * or external libraries/commands. Currently returns null.
   * @private
   * @async
   * @returns {Promise<string | null>} A promise that resolves with the AP's MAC address or null.
   */
  private async getWifiMacAddress(): Promise<string | null> {
    this.log(
      "🔍 Scanning for WiFi networks (placeholder)...",
      undefined,
      LogLevel.DEBUG,
    );
    // Example using a hypothetical command-line tool (replace with actual implementation)
    try {
      // const { stdout } = await execAsync('your-wifi-scan-command');
      // Parse stdout to find the MAC address for this.WIFI_SSID
      // return foundMacAddress;
      this.log(
        "⚠️ WiFi scanning not implemented, cannot get AP MAC.",
        undefined,
        LogLevel.WARN,
      );
      return null; // Placeholder
    } catch (error) {
      this.log("❌ Error scanning WiFi networks", error, LogLevel.ERROR);
      return null;
    }
  }

  /**
   * Checks the current internet connectivity status.
   * It attempts to reach standard connectivity check URLs (Google, Microsoft).
   * Determines if the status is ONLINE, OFFLINE, or behind a CAPTIVE_PORTAL.
   * @private
   * @async
   * @returns {Promise<ConnectivityStatus>} A promise resolving to the determined connectivity status.
   */
  private async checkConnectivityStatus(): Promise<ConnectivityStatus> {
    // Alternative connectivity check URLs
    const checkUrl = "http://connectivitycheck.gstatic.com/generate_204";
    const backupCheckUrl = "http://www.msftconnecttest.com/connecttest.txt";

    this.log(
      `🌐 Checking connectivity status via ${checkUrl}...`,
      undefined,
      LogLevel.DEBUG,
    );

    try {
      // First try Google's connectivity check - status 204 means we're online
      const response = await axios.get(checkUrl, {
        timeout: 5000,
        maxRedirects: 0, // Don't follow redirects automatically
        validateStatus: function (status) {
          return true; // Accept any status code to analyze it
        },
      });

      // Status 204 with empty content from Google means we're online
      if (response.status === 204) {
        this.log(
          `✅ Connectivity check passed: Direct internet access confirmed.`,
          undefined,
          LogLevel.DEBUG,
        );
        return ConnectivityStatus.ONLINE;
      }
      // If we get a redirect or a different status, it's likely a captive portal
      else if (response.status >= 200 && response.status < 400) {
        this.log(
          `⚠️ Connectivity check indicates Captive Portal (Unexpected response: Status ${response.status})`,
          undefined,
          LogLevel.WARN,
        );
        return ConnectivityStatus.CAPTIVE_PORTAL;
      }
      // Any error status probably means we're offline
      else {
        this.log(
          `❓ Unexpected status code ${response.status} during connectivity check. Assuming Offline.`,
          undefined,
          LogLevel.WARN,
        );
        return ConnectivityStatus.OFFLINE;
      }
    } catch (err) {
      // Handle specific errors
      if (axios.isAxiosError(err)) {
        if (err.code === "ECONNABORTED") {
          this.log(
            `❌ Connectivity check failed: Timeout accessing ${checkUrl}`,
            undefined,
            LogLevel.WARN,
          );
        } else if (err.response) {
          this.log(
            `❌ Connectivity check failed: Received status ${err.response.status} from ${checkUrl}`,
            undefined,
            LogLevel.WARN,
          );
        } else if (err.request) {
          this.log(
            `❌ Connectivity check failed: No response received from ${checkUrl}`,
            err.message,
            LogLevel.WARN,
          );
        } else {
          this.log(
            `❌ Connectivity check failed: Error setting up request to ${checkUrl}`,
            err.message,
            LogLevel.ERROR,
          );
        }
      } else {
        this.log(
          `❌ Connectivity check failed: Unknown error accessing ${checkUrl}`,
          err,
          LogLevel.ERROR,
        );
      }

      // Try Microsoft's connectivity check URL as a backup
      try {
        this.log(
          `🔄 Trying backup connectivity check via ${backupCheckUrl}...`,
          undefined,
          LogLevel.DEBUG,
        );
        const backupResponse = await axios.get(backupCheckUrl, {
          timeout: 5000,
          validateStatus: () => true,
        });

        // If we can access Microsoft's URL and get the expected content, we're online
        if (
          backupResponse.data &&
          backupResponse.data.includes("Microsoft Connect Test")
        ) {
          this.log(
            `✅ Backup connectivity check passed: Internet access confirmed.`,
            undefined,
            LogLevel.DEBUG,
          );
          return ConnectivityStatus.ONLINE;
        } else {
          this.log(
            `⚠️ Backup check indicates Captive Portal.`,
            undefined,
            LogLevel.WARN,
          );
          return ConnectivityStatus.CAPTIVE_PORTAL;
        }
      } catch (backupErr) {
        this.log(
          `❌ All connectivity checks failed.`,
          undefined,
          LogLevel.WARN,
        );
        return ConnectivityStatus.OFFLINE;
      }
    }
  }

  /**
   * Attempts to connect to the configured Wi-Fi network using `node-wifi`.
   * @private
   * @async
   * @returns {Promise<void>} A promise that resolves when the connect command is initiated.
   */
  private async connectToWifi() {
    this.log(
      `📶 Attempting to connect to WiFi: ${this.WIFI_SSID} using node-wifi...`,
      undefined,
      LogLevel.INFO,
    );
    try {
      await wifi.connect({
        ssid: this.WIFI_SSID,
        password: this.WIFI_PASSWORD,
      });
      this.log(
        `✅ WiFi connect command initiated for ${this.WIFI_SSID}. Check status shortly.`,
        undefined,
        LogLevel.INFO,
      );
    } catch (error) {
      this.log(
        `❌ Error connecting to WiFi using node-wifi`,
        error,
        LogLevel.ERROR,
      );
    }
  }

  /**
   * Attempts to disconnect from the current Wi-Fi network using `node-wifi`.
   * @private
   * @async
   * @returns {Promise<void>} A promise that resolves when the disconnect command is executed.
   */
  private async disconnectFromWifi() {
    this.log(
      "🔌 Attempting to disconnect from WiFi using node-wifi...",
      undefined,
      LogLevel.INFO,
    );
    try {
      await wifi.disconnect();
      this.log(
        "✅ WiFi disconnect command executed via node-wifi.",
        undefined,
        LogLevel.INFO,
      );
    } catch (error) {
      this.log(
        "❌ Error disconnecting from WiFi using node-wifi",
        error,
        LogLevel.ERROR,
      );
    }
  }

  /**
   * Handles captive portal authentication using Puppeteer.
   * Launches a browser, navigates to a test URL to trigger the portal redirect,
   * attempts to identify the portal page, and then calls `fillCaptivePortalForm`
   * to interact with the login form.
   * Ensures the browser instance is properly closed afterwards.
   * @private
   * @async
   * @returns {Promise<void>} A promise that resolves when the authentication attempt is complete.
   */
  private async authenticateToPortal() {
    // Check if a browser is already running (e.g., from a previous failed attempt)
    if (this.browserInstance) {
      this.log(
        "⚠️ Browser instance already exists. Attempting to close it before launching a new one.",
        undefined,
        LogLevel.WARN,
      );
      try {
        await this.browserInstance.close();
      } catch (closeError) {
        this.log(
          "Error closing existing browser instance",
          closeError,
          LogLevel.ERROR,
        );
      }
      this.browserInstance = null;
    }

    this.log(
      "🤖 Launching browser for portal authentication...",
      undefined,
      LogLevel.INFO,
    );
    let browser: Browser | null = null;
    try {
      // Launch browser (headless: false shows the browser for debugging)
      browser = await puppeteer.launch({
        headless: false, // Keep false for debugging
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-extensions", // Disable extensions
          "--disable-web-security", // Try disabling web security (use with caution)
          "--disable-features=IsolateOrigins,site-per-process,BlockInsecurePrivateNetworkRequests", // Try disabling certain security features
          "--allow-running-insecure-content", // Allow insecure content if needed
        ],
      });
      this.browserInstance = browser; // Store the instance

      const page = await browser.newPage();

      // Set a common user agent
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
      );

      // Add event listener to capture blocked requests
      page.on("requestfailed", (request) => {
        this.log(
          `❌ Request failed: ${request.url()} - ${request.failure()?.errorText}`,
          `Method: ${request.method()}, ResourceType: ${request.resourceType()}`,
          LogLevel.ERROR, // Log as ERROR
        );
      });

      // Set a reasonable timeout
      page.setDefaultNavigationTimeout(30000); // 30 seconds

      this.log(
        `🌐 Navigating to captive portal test URL...`,
        undefined,
        LogLevel.DEBUG,
      );

      // Updated test URLs - Start with the configured AUTH_URL if available
      const alternativeTestUrls = [
        this.AUTH_URL, // Try the configured URL first
        "http://neverssl.com", // A simple HTTP site
        "http://captive.apple.com",
        "http://connectivitycheck.gstatic.com/generate_204",
        "http://www.msftconnecttest.com/connecttest.txt",
      ];

      let portalUrlFound: string | null = null;

      // Updated navigation logic to cycle through alternative URLs
      for (const testUrl of alternativeTestUrls) {
        try {
          this.log(
            `🌐 Trying navigation to: ${testUrl}...`, // Log the URL being tried
            undefined,
            LogLevel.DEBUG,
          );
          // Use 'domcontentloaded' as sometimes networkidle isn't reached on redirects
          const response = await page.goto(testUrl, {
            waitUntil: "domcontentloaded",
            timeout: 15000, // Shorter timeout per URL
          });

          const currentUrl = page.url();
          const status = response?.status();
          this.log(
            `➡️ Navigated to ${testUrl}. Current URL: ${currentUrl}, Status: ${status}`,
            undefined,
            LogLevel.DEBUG,
          );

          // Check if we landed on a likely captive portal page
          // Add more keywords if needed based on the actual portal URL/content
          if (
            currentUrl.includes("login") ||
            currentUrl.includes("auth") ||
            currentUrl.includes("hotspot") ||
            currentUrl.includes("redirect") || // Check if it's still the redirect URL
            status !== 200 // Or if the status isn't a simple OK
          ) {
            this.log(
              `✅ Possible captive portal detected at URL: ${currentUrl}`,
              undefined,
              LogLevel.INFO,
            );
            portalUrlFound = currentUrl;
            break; // Exit loop once portal is likely found
          } else {
            this.log(
              `❓ URL ${testUrl} resulted in ${currentUrl} (Status: ${status}). Not identified as portal.`,
              undefined,
              LogLevel.DEBUG,
            );
          }
        } catch (error: any) {
          // Log navigation errors more clearly
          const errorMessage = error.message || "Unknown navigation error";
          this.log(
            `❌ Error navigating to ${testUrl}: ${errorMessage}. Trying next URL if available...`,
            error.stack, // Include stack trace if available
            LogLevel.WARN,
          );
          // If the error is the specific block error, log it prominently
          if (errorMessage.includes("net::ERR_BLOCKED_BY_CLIENT")) {
            this.log(
              `🚫 Navigation to ${testUrl} was blocked by the client (net::ERR_BLOCKED_BY_CLIENT). Check antivirus/firewall.`,
              undefined,
              LogLevel.ERROR,
            );
          }
          // Add a small delay before trying the next URL
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // If no portal URL was detected after trying all test URLs
      if (!portalUrlFound) {
        this.log(
          "⚠️ Could not reliably detect the captive portal page after trying multiple URLs.",
          undefined,
          LogLevel.WARN,
        );
        // Optionally, attempt to proceed anyway assuming the current page might be it
        this.log(
          `🤔 Proceeding with the current page (${page.url()}) for form filling attempt.`,
          undefined,
          LogLevel.DEBUG,
        );
      } else {
        this.log(
          `🎯 Proceeding with detected portal URL: ${portalUrlFound}`,
          undefined,
          LogLevel.INFO,
        );
      }

      // Try to find input fields for the login form
      this.log(
        "🔍 Looking for form fields on the page...",
        undefined,
        LogLevel.DEBUG,
      );

      // Get a screenshot for debugging
      try {
        await page.screenshot({ path: "captive-portal.png" });
        this.log(
          "📸 Saved screenshot to captive-portal.png for debugging",
          undefined,
          LogLevel.DEBUG,
        );
      } catch (screenshotError) {
        this.log(
          "⚠️ Failed to save screenshot.",
          screenshotError,
          LogLevel.WARN,
        );
      }

      // Try to find and fill the form fields
      const formFilled = await this.fillCaptivePortalForm(page);

      if (formFilled) {
        this.log(
          "✅ Form interaction attempted (check logs for details)", // Changed log message
          undefined,
          LogLevel.INFO,
        );
      } else {
        this.log(
          "⚠️ Could not find/fill form fields or click submit button", // Changed log message
          undefined,
          LogLevel.WARN,
        );
      }

      // Wait a bit after authentication attempt to let the network stabilize
      this.log(
        "⏳ Waiting 5s after form submission attempt...",
        undefined,
        LogLevel.DEBUG,
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch (error) {
      this.log("❌ Error during browser authentication", error, LogLevel.ERROR);
    } finally {
      if (browser) {
        this.log("🔍 Closing browser.", undefined, LogLevel.DEBUG);
        try {
          await browser.close();
        } catch (closeError) {
          this.log(
            "Error closing browser instance in finally block",
            closeError,
            LogLevel.ERROR,
          );
        }
        this.browserInstance = null; // Ensure instance is cleared
      }
    }
  }

  /**
   * Attempts to find and fill the login form fields on the captive portal page
   * and click the submit button using Puppeteer.
   * Tries multiple common selectors for each field and the submit button.
   * @private
   * @async
   * @param {Page} page - The Puppeteer Page object representing the captive portal page.
   * @returns {Promise<boolean>} A promise resolving to true if the submit button was successfully clicked, false otherwise.
   */
  private async fillCaptivePortalForm(page: Page): Promise<boolean> {
    try {
      // Check for common form fields in captive portals
      const formFieldsFound = {
        idnumber: false,
        name: false,
        surname: false,
        birthyear: false,
      };

      const fieldSelectors = {
        idnumber: [
          "#idnumber",
          'input[name="idnumber"]',
          'input[placeholder*="TC"]',
          'input[name*="user"]', // More generic username/id
        ],
        name: [
          "#name",
          'input[name="name"]',
          'input[placeholder*="Ad"]',
          'input[placeholder*="First Name"]',
        ],
        surname: [
          "#surname",
          'input[name="surname"]',
          'input[placeholder*="Soyad"]',
          'input[placeholder*="Last Name"]',
        ],
        birthyear: [
          "#birthyear",
          'input[name="birthyear"]',
          'input[placeholder*="Doğum"]',
          'input[placeholder*="Birth"]',
        ],
      };

      const formData = {
        idnumber: this.FORM_DATA.idnumber,
        name: this.FORM_DATA.name,
        surname: this.FORM_DATA.surname,
        birthyear: this.FORM_DATA.birthyear,
      };

      /**
       * Helper function to try multiple selectors to find and fill a form field.
       * @param {keyof typeof formFieldsFound} fieldName - The logical name of the field.
       * @param {string} value - The value to type into the field.
       * @returns {Promise<boolean>} True if the field was successfully filled, false otherwise.
       */
      const fillField = async (
        fieldName: keyof typeof formFieldsFound,
        value: string,
      ): Promise<boolean> => {
        for (const selector of fieldSelectors[fieldName]) {
          try {
            // Wait for selector with a shorter timeout
            await page.waitForSelector(selector, {
              timeout: 3000,
              visible: true,
            });
            await page.type(selector, value, { delay: 50 }); // Add slight delay
            this.log(
              `✓ Filled ${fieldName} field (selector: ${selector}) with: ${value}`,
              undefined,
              LogLevel.DEBUG,
            );
            formFieldsFound[fieldName] = true;
            return true; // Field filled successfully
          } catch (e) {
            this.log(
              `Selector ${selector} for ${fieldName} not found or interactable.`,
              undefined, // Don't log the full error unless necessary
              LogLevel.DEBUG, // Log as debug unless it's the last attempt
            );
          }
        }
        this.log(
          `Could not find or fill ${fieldName} field using any selector.`,
          undefined,
          LogLevel.WARN,
        );
        return false; // Field not filled
      };

      // Fill fields sequentially
      await fillField("idnumber", formData.idnumber);
      await fillField("name", formData.name);
      await fillField("surname", formData.surname);
      await fillField("birthyear", formData.birthyear);

      // Look for and click the submit/connect button
      const buttonSelectors = [
        "button.ibtn", // Specific selector from Hotspot.html
        'button[type="submit"]',
        'input[type="submit"]',
        'button[id*="submit"]',
        'button[id*="connect"]',
        'button[id*="login"]',
        // 'button:contains("Bağlan")', // Text-based selectors (less reliable, might need configuration)
        // 'button:contains("Connect")',
        // 'button:contains("Login")',
        // 'button:contains("Submit")',
        ".connect-btn", // Original selector
      ];

      this.log("🔍 Looking for submit button...", undefined, LogLevel.DEBUG);

      // Try each button selector
      let buttonClicked = false;
      for (const selector of buttonSelectors) {
        try {
          // Wait for button to be visible and enabled
          await page.waitForSelector(selector, {
            timeout: 3000,
            visible: true,
          });
          const buttonElement = await page.$(selector); // Get element handle

          if (buttonElement) {
            this.log(
              `🖱️ Found potential submit button with selector: ${selector}`,
              undefined,
              LogLevel.DEBUG,
            );

            // Check if the button is actually clickable (visible and not disabled)
            const isVisible = await buttonElement.isIntersectingViewport();
            // const isDisabled = await page.$eval(selector, (btn) => btn.disabled); // Might fail if btn doesn't have disabled prop

            if (isVisible) {
              // Simplified check
              this.log(
                `Attempting to click button: ${selector}`,
                undefined,
                LogLevel.DEBUG,
              );
              // Use Promise.all to handle navigation that might happen after click
              await Promise.all([
                page.click(selector),
                // Wait either for navigation or a timeout
                // Use 'load' or 'domcontentloaded' which might be more reliable than networkidle
                page
                  .waitForNavigation({ timeout: 15000, waitUntil: "load" })
                  .catch((navError: any) => {
                    this.log(
                      `Navigation after click on ${selector} did not complete fully or timed out: ${navError.message}`,
                      undefined,
                      LogLevel.DEBUG,
                    );
                    // Don't treat timeout as critical failure here, portal might just update via JS
                  }),
              ]);

              buttonClicked = true;
              this.log(
                `✅ Clicked the submit button with selector: ${selector}`,
                undefined,
                LogLevel.INFO,
              );
              break; // Exit loop after successful click
            } else {
              this.log(
                `Button ${selector} found but not visible/clickable.`,
                undefined,
                LogLevel.DEBUG,
              );
            }
          }
        } catch (e: any) {
          // Log only if the error isn't just a timeout (selector not found)
          if (!e.message.includes("timeout")) {
            this.log(
              `Error interacting with button selector: ${selector}`,
              e.message,
              LogLevel.DEBUG,
            );
          } else {
            this.log(
              `Button selector ${selector} not found within timeout.`,
              undefined,
              LogLevel.DEBUG,
            );
          }
        }
      }

      if (!buttonClicked) {
        this.log(
          "⚠️ Could not find or click any suitable submit button.",
          undefined,
          LogLevel.WARN,
        );
        // Try taking another screenshot if button click failed
        try {
          await page.screenshot({ path: "captive-portal-no-button.png" });
          this.log(
            "📸 Saved screenshot to captive-portal-no-button.png",
            undefined,
            LogLevel.DEBUG,
          );
        } catch (screenshotError) {
          this.log(
            "⚠️ Failed to save no-button screenshot.",
            screenshotError,
            LogLevel.WARN,
          );
        }
        return false;
      }

      // Consider the form filled if at least one field was found and the button was clicked
      const successfulFormFill = Object.values(formFieldsFound).some(
        (val) => val === true,
      );
      if (!successfulFormFill) {
        this.log(
          "⚠️ No form fields were successfully filled, but button was clicked.",
          undefined,
          LogLevel.WARN,
        );
      }

      return buttonClicked; // Return true if button was clicked, even if fields weren't filled (portal might not need them)
    } catch (error) {
      this.log("❌ Error filling captive portal form", error, LogLevel.ERROR);
      return false;
    }
  }

  /**
   * The main monitoring loop.
   * Periodically checks connectivity status and takes appropriate action:
   * - OFFLINE: Attempts to connect to Wi-Fi.
   * - CAPTIVE_PORTAL: Attempts to authenticate using Puppeteer.
   * - ONLINE: Logs status (enters silent mode after several consecutive checks).
   * Handles graceful shutdown on SIGINT/SIGTERM.
   * @public
   * @async
   * @returns {Promise<void>} A promise that never resolves, as the loop runs indefinitely.
   */
  public async monitor() {
    // Ensure config is loaded before starting monitor
    if (!this.config) {
      this.log(
        "❌ Configuration not initialized. Call init() before monitor().",
        undefined,
        LogLevel.ERROR,
      );
      return; // Or throw an error
    }

    this.log("🚀 AutoLogin script started.", undefined, LogLevel.INFO);
    this.log(
      `🔧 Config: SSID=${this.WIFI_SSID}, AuthURL=${this.AUTH_URL}, Interval=${this.LOGIN_INTERVAL_MS}ms`,
      undefined,
      LogLevel.DEBUG,
    );
    this.log(
      `📝 UserData: ${JSON.stringify(this.FORM_DATA)}`,
      undefined,
      LogLevel.DEBUG,
    );

    /**
     * Handles graceful shutdown signals (SIGINT, SIGTERM).
     * Closes the Puppeteer browser instance if it's open.
     * @param {string} signal - The signal received (e.g., 'SIGINT').
     */
    const shutdown = async (signal: string) => {
      this.log(
        `${signal} received. Shutting down browser if open...`,
        undefined,
        LogLevel.INFO,
      );
      if (this.browserInstance) {
        this.log(
          "Attempting to close browser instance...",
          undefined,
          LogLevel.DEBUG,
        );
        try {
          await this.browserInstance.close();
          this.log(
            "Browser instance closed successfully.",
            undefined,
            LogLevel.INFO,
          );
        } catch (closeError) {
          this.log(
            "Error closing browser instance during shutdown",
            closeError,
            LogLevel.ERROR,
          );
        }
        this.browserInstance = null;
      }
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    this.log(
      `🔄 Performing initial WiFi disconnect for a clean state...`,
      undefined,
      LogLevel.INFO,
    );
    await this.disconnectFromWifi();
    await new Promise((res) => setTimeout(res, 3000)); // Wait a bit after disconnect

    while (true) {
      const currentTime = Date.now();
      const uptimeSinceLastSuccess = Math.floor(
        (currentTime - this.lastSuccessTime) / 1000,
      );

      // Get connectivity status
      const status = await this.checkConnectivityStatus();

      switch (status) {
        case ConnectivityStatus.OFFLINE:
          this.connectionAttempts++;
          this.consecutiveActiveConnections = 0;
          if (this.silentMode) {
            this.silentMode = false;
            await this.log(
              `🔊 Network OFFLINE - Exiting silent mode`,
              undefined,
              LogLevel.INFO,
            );
          }
          await this.log(
            `🌐 Network OFFLINE (Attempt #${this.connectionAttempts}, Last success: ${uptimeSinceLastSuccess}s ago). Trying to connect WiFi...`,
            undefined,
            LogLevel.WARN,
          );
          await this.connectToWifi();
          await this.log(
            `⏳ Waiting 10s after WiFi connect attempt...`,
            undefined,
            LogLevel.DEBUG,
          );
          await new Promise((res) => setTimeout(res, 10000)); // Increased wait time to 10 seconds
          break;

        case ConnectivityStatus.CAPTIVE_PORTAL:
          this.connectionAttempts++; // Count portal state as needing action
          this.consecutiveActiveConnections = 0;
          if (this.silentMode) {
            this.silentMode = false;
            await this.log(
              `🔊 Captive Portal detected - Exiting silent mode`,
              undefined,
              LogLevel.INFO,
            );
          }
          await this.log(
            `🚪 Captive Portal detected (Attempt #${this.connectionAttempts}, Last success: ${uptimeSinceLastSuccess}s ago). Attempting authentication via browser...`,
            undefined,
            LogLevel.INFO,
          );
          // Call the browser-based authentication
          await this.authenticateToPortal();
          await this.log(
            `⏳ Waiting 10s after browser auth attempt...`,
            undefined,
            LogLevel.DEBUG,
          );
          await new Promise((res) => setTimeout(res, 10000)); // Wait longer after browser auth
          break;

        case ConnectivityStatus.ONLINE:
          // Only count as successful *connection* if previous state was not ONLINE
          if (this.consecutiveActiveConnections === 0) {
            this.successfulConnections++;
            this.lastSuccessTime = Date.now(); // Reset timer on regaining connection
            await this.log(
              `✅ Connection successfully established/confirmed (Total successful connections: ${this.successfulConnections})`,
              undefined,
              LogLevel.INFO,
            );
          }

          this.consecutiveActiveConnections++;
          // Reset connection attempts counter as we are online
          if (this.connectionAttempts > 0) {
            await this.log(
              `🔄 Resetting connection attempts counter as connection is now ONLINE.`,
              undefined,
              LogLevel.DEBUG,
            );
            this.connectionAttempts = 0;
          }

          if (this.consecutiveActiveConnections >= 3 && !this.silentMode) {
            // Enter silent mode after 3 checks
            this.silentMode = true;
            await this.log(
              `🔇 Connection stable (${this.consecutiveActiveConnections} checks) - Entering silent mode`,
              undefined,
              LogLevel.INFO,
            );
          }
          // Log status only if not in silent mode
          if (!this.silentMode) {
            await this.log(
              `✅ Connection active (Stable for ${this.consecutiveActiveConnections} checks, Last success: ${uptimeSinceLastSuccess}s ago)`,
              undefined,
              LogLevel.INFO,
            );
          }
          break;
      }

      // Log sleep duration only if not in silent mode or if debugging level is active
      if (
        !this.silentMode ||
        LogLevel.DEBUG >=
          (process.env.LOG_LEVEL
            ? LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel]
            : LogLevel.INFO)
      ) {
        await this.log(
          `💤 Sleeping for ${this.LOGIN_INTERVAL_MS / 1000}s before next check...`,
          undefined,
          LogLevel.DEBUG,
        );
      }
      await new Promise((res) => setTimeout(res, this.LOGIN_INTERVAL_MS));
    }
  }
}

/**
 * Initializes and starts the AutoLogin application.
 * Creates an instance of AutoLogin, calls its init() method,
 * and then starts the monitoring loop. Handles fatal startup errors.
 * @async
 */
async function startApp() {
  const autoLogin = new AutoLogin();
  try {
    await autoLogin.init(); // Initialize configuration first
    await autoLogin.monitor(); // Then start monitoring
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}][FATAL] Application failed to start:`,
      error,
    );
    process.exit(1); // Exit if initialization fails
  }
}

startApp(); // Run the async start function
