import axios from "axios";
import * as path from "path";
import * as os from "os"; // Ensure os is imported at the top
import wifi from "node-wifi"; // Import node-wifi
import puppeteer, { Browser } from "puppeteer"; // Add Puppeteer for browser-based authentication
// import { exec } from 'child_process'; // Keep commented if not used
// import { promisify } from 'util'; // Keep commented if not used
// const execAsync = promisify(exec);

// Log levels for more granular logging
enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

// Add a new enum for connectivity status
enum ConnectivityStatus {
  ONLINE = "ONLINE",
  OFFLINE = "OFFLINE",
  CAPTIVE_PORTAL = "CAPTIVE_PORTAL",
}

class AutoLogin {
  private WIFI_SSID: string; // Wi-Fi network name
  private WIFI_PASSWORD: string; // Wi-Fi password (if needed)
  private AUTH_URL: string; // Captive portal POST URL
  private LOGIN_INTERVAL_MS: number; // Check every N seconds
  private LOG_FILE: string;
  private FORM_DATA: {
    idnumber: string; // Changed from TC_NU to match Hotspot.html
    name: string; // Changed from NAME
    surname: string; // Changed from SURNAME
    birthyear: string; // Changed from BIRTH_YEAR
  };
  private connectionAttempts: number = 0;
  private successfulConnections: number = 0;
  private lastSuccessTime: number = Date.now();
  private consecutiveActiveConnections: number = 0;
  private silentMode: boolean = false;
  private browserInstance: Browser | null = null; // Track browser instance for cleanup

  constructor() {
    this.WIFI_SSID = process.env.WIFI_SSID || "COORDINAT";
    this.WIFI_PASSWORD = process.env.WIFI_PASSWORD || "";
    this.AUTH_URL =
      process.env.AUTH_URL || "http://www.msftconnecttest.com/redirect";
    this.LOGIN_INTERVAL_MS = process.env.LOGIN_INTERVAL_MS
      ? parseInt(process.env.LOGIN_INTERVAL_MS)
      : 5_000; // 5 seconds
    this.LOG_FILE = path.join(__dirname, "connection.log");
    this.FORM_DATA = {
      // Use keys from Hotspot.html
      idnumber: process.env.TC_NU || "12345678901", // Corrected from TC_NO to TC_NU
      name: process.env.NAME || "YourName", // First Name
      surname: process.env.SURNAME || "YourSurname", // Last Name
      birthyear: process.env.BIRTH_YEAR || "2000", // Birth Year
    };

    // Initialize node-wifi
    wifi.init({
      iface: null, // network interface, choose a random wifi interface if set to null
    });
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
    }

    // Append to log file
    // fs.appendFile(this.LOG_FILE, logMessage + '\n', (err) => {
    //   if (err) {
    //     console.error(`[${new Date().toISOString()}][ERROR] Failed to write to log file: ${err.message}`);
    //   }
    // });
  }

  // Get device MAC address
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

  // Scan for WiFi networks and get the target network's MAC address
  // Note: This functionality is highly OS-dependent and might require external libraries or commands.
  // This is a placeholder and likely won't work out-of-the-box on all systems.
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

  // UPDATED Connection check (detects captive portal and extracts params)
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

  // Connect to Wi-Fi using node-wifi
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

  // Disconnect from current WiFi using node-wifi
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

  // UPDATED Captive portal login to accept and use redirect parameters
  // REWRITTEN Captive portal login using Puppeteer
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
           await new Promise(resolve => setTimeout(resolve, 500));
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
         this.log("⚠️ Failed to save screenshot.", screenshotError, LogLevel.WARN);
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
      this.log("⏳ Waiting 5s after form submission attempt...", undefined, LogLevel.DEBUG);
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

  // Helper method to find and fill the captive portal form
  private async fillCaptivePortalForm(page: any): Promise<boolean> {
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
          '#idnumber',
          'input[name="idnumber"]',
          'input[placeholder*="TC"]',
          'input[name*="user"]', // More generic username/id
        ],
        name: [
          '#name',
          'input[name="name"]',
          'input[placeholder*="Ad"]',
          'input[placeholder*="First Name"]',
        ],
        surname: [
          '#surname',
          'input[name="surname"]',
          'input[placeholder*="Soyad"]',
          'input[placeholder*="Last Name"]',
        ],
        birthyear: [
          '#birthyear',
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

      // Function to try multiple selectors for a field
      const fillField = async (fieldName: keyof typeof formFieldsFound, value: string) => {
        for (const selector of fieldSelectors[fieldName]) {
          try {
            // Wait for selector with a shorter timeout
            await page.waitForSelector(selector, { timeout: 3000, visible: true });
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
        this.log(`Could not find or fill ${fieldName} field using any selector.`, undefined, LogLevel.WARN);
        return false; // Field not filled
      };

      // Fill fields sequentially
      await fillField('idnumber', formData.idnumber);
      await fillField('name', formData.name);
      await fillField('surname', formData.surname);
      await fillField('birthyear', formData.birthyear);


      // Look for and click the submit/connect button
      const buttonSelectors = [
        "button.ibtn", // Specific selector from Hotspot.html
        'button[type="submit"]',
        'input[type="submit"]',
        'button[id*="submit"]',
        'button[id*="connect"]',
        'button[id*="login"]',
        'button:contains("Bağlan")', // Text-based selectors (less reliable)
        'button:contains("Connect")',
        'button:contains("Login")',
        'button:contains("Submit")',
        ".connect-btn", // Original selector
      ];

      this.log("🔍 Looking for submit button...", undefined, LogLevel.DEBUG);

      // Try each button selector
      let buttonClicked = false;
      for (const selector of buttonSelectors) {
        try {
           // Wait for button to be visible and enabled
           await page.waitForSelector(selector, { timeout: 3000, visible: true });
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

             if (isVisible) { // Simplified check
                this.log(`Attempting to click button: ${selector}`, undefined, LogLevel.DEBUG);
                // Use Promise.all to handle navigation that might happen after click
                await Promise.all([
                  page.click(selector),
                  // Wait either for navigation or a timeout
                  // Use 'load' or 'domcontentloaded' which might be more reliable than networkidle
                  page.waitForNavigation({ timeout: 15000, waitUntil: 'load' }).catch((navError: any) => {
                     this.log(`Navigation after click on ${selector} did not complete fully or timed out: ${navError.message}`, undefined, LogLevel.DEBUG);
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
                this.log(`Button ${selector} found but not visible/clickable.`, undefined, LogLevel.DEBUG);
             }
           }
        } catch (e: any) {
          // Log only if the error isn't just a timeout (selector not found)
          if (!e.message.includes('timeout')) {
             this.log(
              `Error interacting with button selector: ${selector}`,
              e.message,
              LogLevel.DEBUG,
            );
          } else {
             this.log(`Button selector ${selector} not found within timeout.`, undefined, LogLevel.DEBUG);
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
          this.log("📸 Saved screenshot to captive-portal-no-button.png", undefined, LogLevel.DEBUG);
        } catch (screenshotError) {
           this.log("⚠️ Failed to save no-button screenshot.", screenshotError, LogLevel.WARN);
        }
        return false;
      }

      // Consider the form filled if at least one field was found and the button was clicked
      const successfulFormFill = Object.values(formFieldsFound).some(
        (val) => val === true,
      );
      if (!successfulFormFill) {
         this.log("⚠️ No form fields were successfully filled, but button was clicked.", undefined, LogLevel.WARN);
      }

      return buttonClicked; // Return true if button was clicked, even if fields weren't filled (portal might not need them)

    } catch (error) {
      this.log("❌ Error filling captive portal form", error, LogLevel.ERROR);
      return false;
    }
  }

  // Updated main loop for puppeteer-based authentication
  public async monitor() {
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

    // Graceful shutdown handling
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
            this.log(
              `🔊 Network OFFLINE - Exiting silent mode`,
              undefined,
              LogLevel.INFO,
            );
          }
          this.log(
            `🌐 Network OFFLINE (Attempt #${this.connectionAttempts}, Last success: ${uptimeSinceLastSuccess}s ago). Trying to connect WiFi...`,
            undefined,
            LogLevel.WARN,
          );
          await this.connectToWifi();
          this.log(
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
            this.log(
              `🔊 Captive Portal detected - Exiting silent mode`,
              undefined,
              LogLevel.INFO,
            );
          }
          this.log(
            `🚪 Captive Portal detected (Attempt #${this.connectionAttempts}, Last success: ${uptimeSinceLastSuccess}s ago). Attempting authentication via browser...`,
            undefined,
            LogLevel.INFO,
          );
          // Call the browser-based authentication
          await this.authenticateToPortal();
          this.log(
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
            this.log(
              `✅ Connection successfully established/confirmed (Total successful connections: ${this.successfulConnections})`,
              undefined,
              LogLevel.INFO,
            );
          }

          this.consecutiveActiveConnections++;
          // Reset connection attempts counter as we are online
          if (this.connectionAttempts > 0) {
            this.log(
              `🔄 Resetting connection attempts counter as connection is now ONLINE.`,
              undefined,
              LogLevel.DEBUG,
            );
            this.connectionAttempts = 0;
          }

          if (this.consecutiveActiveConnections >= 3 && !this.silentMode) {
            // Enter silent mode after 3 checks
            this.silentMode = true;
            this.log(
              `🔇 Connection stable (${this.consecutiveActiveConnections} checks) - Entering silent mode`,
              undefined,
              LogLevel.INFO,
            );
          }
          // Log status only if not in silent mode
          if (!this.silentMode) {
            this.log(
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
        this.log(
          `💤 Sleeping for ${this.LOGIN_INTERVAL_MS / 1000}s before next check...`,
          undefined,
          LogLevel.DEBUG,
        );
      }
      await new Promise((res) => setTimeout(res, this.LOGIN_INTERVAL_MS));
    }
  }
}

// Start
const autoLogin = new AutoLogin();
autoLogin.monitor();
