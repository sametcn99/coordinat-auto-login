import * as path from "path";
import ora from "ora";
import { Logger } from "./logger";
import { ConfigManager } from "./configManager";
import { PortalAuthenticator } from "./portalAuthenticator";
import type { Ora } from "ora"; // Use import type
import { ConnectivityChecker } from "./connectivityChecker";
import { WifiManager } from "./wifiManager";
import {
  ConnectivityStatus,
  LogLevel,
  type AppConfig,
  type PortalFormData,
} from "./types"; // Use import type

export class App {
  private logger: Logger;
  private configManager: ConfigManager;
  private wifiManager: WifiManager;
  private connectivityChecker: ConnectivityChecker;
  private portalAuthenticator!: PortalAuthenticator; // Initialized in init
  private config!: AppConfig; // Loaded in init
  private formData!: PortalFormData; // Derived in init

  // State Variables
  private connectionAttempts: number = 0;
  private successfulConnections: number = 0;
  private lastSuccessTime: number = Date.now();
  private consecutiveActiveConnections: number = 0;
  private silentModeSpinner: Ora | null = null;

  // Constants
  private readonly CONSECUTIVE_CHECKS_FOR_SILENT = 5; // Enter silent mode after 5 good checks
  private readonly MAX_CONNECTION_ATTEMPTS = 3; // Max attempts before longer pause

  constructor() {
    const logDir = path.dirname(require.main?.filename || process.cwd());
    this.logger = new Logger(logDir);
    this.configManager = new ConfigManager(this.logger, logDir);
    this.wifiManager = new WifiManager(this.logger);
    this.connectivityChecker = new ConnectivityChecker(this.logger);
    // PortalAuthenticator needs config, initialized later
  }

  /**
   * Initializes the application components.
   * Loads config, initializes wifi, creates authenticator.
   */
  public async init(): Promise<boolean> {
    try {
      await this.logger.log(
        "🚀 Initializing AutoLogin Application...",
        undefined,
        LogLevel.INFO,
      );
      this.config = await this.configManager.loadOrPromptConfig();

      // Derive form data from config
      this.formData = {
        idnumber: this.config.TC_NU,
        name: this.config.NAME,
        surname: this.config.SURNAME,
        birthyear: this.config.BIRTH_YEAR,
      };

      // Initialize Wifi Manager
      this.wifiManager.init();

      // Initialize Portal Authenticator with loaded config/data
      this.portalAuthenticator = new PortalAuthenticator(
        this.logger,
        this.formData,
        this.config.AUTH_URL,
      );

      await this.logger.log(
        "✅ Initialization complete.",
        undefined,
        LogLevel.INFO,
      );
      await this.logger.log(
        `🔧 Config: SSID=${this.config.WIFI_SSID}, AuthURL=${this.config.AUTH_URL}, Interval=${this.config.LOGIN_INTERVAL_MS}ms`,
        undefined,
        LogLevel.DEBUG,
      );
      await this.logger.log(
        `📝 UserData: id=${this.formData.idnumber.substring(0, 3)}... year=${this.formData.birthyear}`, // Log partial data
        undefined,
        LogLevel.DEBUG,
      );
      return true;
    } catch (error) {
      await this.logger.log(
        "❌ Fatal error during initialization",
        error,
        LogLevel.ERROR,
      );
      return false;
    }
  }

  /**
   * Starts the main monitoring loop.
   */
  public async startMonitoring(): Promise<void> {
    if (!this.config || !this.portalAuthenticator) {
      await this.logger.log(
        "❌ Cannot start monitoring: App not initialized.",
        undefined,
        LogLevel.ERROR,
      );
      return;
    }

    this.setupSignalHandlers();

    await this.logger.log(
      "🔄 Starting monitoring loop...",
      undefined,
      LogLevel.INFO,
    );

    // Perform initial disconnect for a clean state
    await this.logger.log(
      "🔌 Performing initial WiFi disconnect...",
      undefined,
      LogLevel.DEBUG,
    );
    await this.wifiManager.disconnectFromWifi();
    await new Promise((res) => setTimeout(res, 3000)); // Wait after disconnect

    // Main loop
    while (true) {
      const startTime = Date.now();
      let status = ConnectivityStatus.OFFLINE; // Default status

      try {
        status = await this.connectivityChecker.checkConnectivityStatus();

        switch (status) {
          case ConnectivityStatus.ONLINE:
            await this.handleOnlineStatus();
            break;
          case ConnectivityStatus.CAPTIVE_PORTAL:
            await this.handleCaptivePortalStatus();
            break;
          case ConnectivityStatus.OFFLINE:
            await this.handleOfflineStatus();
            break;
          default:
            await this.logger.log(
              `❓ Unknown connectivity status: ${status}`,
              undefined,
              LogLevel.WARN,
            );
            await this.handleOfflineStatus(); // Treat unknown as offline
            break;
        }
      } catch (loopError) {
        await this.logger.log(
          "❌ Unhandled error in monitoring loop",
          loopError,
          LogLevel.ERROR,
        );
        // Reset connection attempts on loop error to avoid immediate retry loops
        this.connectionAttempts = 0;
        // Exit silent mode if an error occurs
        if (this.logger.isSilent()) {
          this.exitSilentMode("Loop error occurred");
        }
      }

      // Calculate time taken and adjust sleep duration
      const endTime = Date.now();
      const duration = endTime - startTime;
      const sleepTime = Math.max(0, this.config.LOGIN_INTERVAL_MS - duration);

      if (!this.logger.isSilent()) {
        await this.logger.log(
          `💤 Sleeping for ${sleepTime / 1000}s (Check took ${duration}ms)...`,
          undefined,
          LogLevel.DEBUG,
        );
      } else {
        this.logger.updateSilentModeSpinner(); // Keep spinner updated
      }

      await new Promise((res) => setTimeout(res, sleepTime));
    }
  }

  // --- Status Handling Methods ---

  private async handleOnlineStatus(): Promise<void> {
    if (this.logger.isSilent()) {
      this.logger.updateSilentModeSpinner(); // Just update spinner in silent mode
      return;
    }

    // Reset connection attempts on success
    if (this.connectionAttempts > 0) {
      await this.logger.log(
        `👍 Connection successful after ${this.connectionAttempts} attempt(s).`,
        undefined,
        LogLevel.INFO,
      );
      this.connectionAttempts = 0;
    }

    this.consecutiveActiveConnections++;
    this.successfulConnections++;
    this.lastSuccessTime = Date.now();

    await this.logger.log(
      `✅ Connection Status: ONLINE (${this.consecutiveActiveConnections} consecutive)`,
      `Total successes: ${this.successfulConnections}`,
      LogLevel.INFO,
    );

    // Enter silent mode after enough consecutive checks
    if (
      this.consecutiveActiveConnections >= this.CONSECUTIVE_CHECKS_FOR_SILENT
    ) {
      this.enterSilentMode();
    }
  }

  private async handleCaptivePortalStatus(): Promise<void> {
    this.exitSilentMode("Captive portal detected");
    this.consecutiveActiveConnections = 0; // Reset consecutive count
    this.connectionAttempts++;

    await this.logger.log(
      `⚠️ Connection Status: CAPTIVE_PORTAL (Attempt ${this.connectionAttempts}/${this.MAX_CONNECTION_ATTEMPTS})`,
      undefined,
      LogLevel.WARN,
    );

    if (this.connectionAttempts > this.MAX_CONNECTION_ATTEMPTS) {
      await this.logger.log(
        `🥵 Too many consecutive portal attempts. Pausing for 60s...`,
        undefined,
        LogLevel.WARN,
      );
      await new Promise((res) => setTimeout(res, 60000));
      this.connectionAttempts = 1; // Reset attempts after pause, try once more
    }

    // Attempt authentication
    const authSuccess = await this.portalAuthenticator.authenticate();

    if (authSuccess) {
      await this.logger.log(
        "🔑 Portal authentication attempt finished. Re-checking status...",
        undefined,
        LogLevel.INFO,
      );
      // Optionally force an immediate re-check instead of waiting for the loop
      // status = await this.connectivityChecker.checkConnectivityStatus();
      // ... handle new status ...
    } else {
      await this.logger.log(
        " FAILED authentication attempt.",
        undefined,
        LogLevel.WARN,
      );
      // Consider a small delay before the next loop iteration after failed auth
      await new Promise((res) => setTimeout(res, 2000));
    }
  }

  private async handleOfflineStatus(): Promise<void> {
    this.exitSilentMode("Connection offline");
    this.consecutiveActiveConnections = 0; // Reset consecutive count
    this.connectionAttempts++;

    await this.logger.log(
      `❌ Connection Status: OFFLINE (Attempt ${this.connectionAttempts}/${this.MAX_CONNECTION_ATTEMPTS})`,
      undefined,
      LogLevel.WARN,
    );

    if (this.connectionAttempts > this.MAX_CONNECTION_ATTEMPTS) {
      await this.logger.log(
        `🥵 Too many consecutive offline attempts. Pausing for 30s...`,
        undefined,
        LogLevel.WARN,
      );
      await new Promise((res) => setTimeout(res, 30000));
      this.connectionAttempts = 1; // Reset attempts after pause, try once more
    }

    // Attempt to connect to Wi-Fi
    await this.wifiManager.connectToWifi(
      this.config.WIFI_SSID,
      this.config.WIFI_PASSWORD,
    );
    // Wait a bit after connection attempt before next check
    await new Promise((res) => setTimeout(res, 5000));
  }

  // --- Silent Mode ---

  private enterSilentMode(): void {
    if (!this.logger.isSilent()) {
      this.silentModeSpinner = ora(
        "Connection active. Silent mode starting...",
      ).start();
      this.logger.setSilentMode(true, this.silentModeSpinner);
      this.logger.updateSilentModeSpinner(); // Set initial duration text
      // Log entry *before* suppressing logs
      this.logger.log(
        `😴 Entering silent mode after ${this.CONSECUTIVE_CHECKS_FOR_SILENT} successful checks.`,
        undefined,
        LogLevel.INFO,
      );
    }
  }

  private exitSilentMode(reason: string): void {
    if (this.logger.isSilent()) {
      const durationMs = this.logger.getSilentDurationMs();
      const durationStr = durationMs
        ? ` after ${this.logger["formatDuration"](durationMs)}`
        : ""; // Access private method carefully if needed

      if (this.silentModeSpinner) {
        this.silentModeSpinner.fail(
          `Silent mode ended: ${reason}${durationStr}`,
        );
      }
      this.logger.setSilentMode(false); // Turn off silent mode in logger
      this.silentModeSpinner = null;
      // Log exit *after* re-enabling logs
      this.logger.log(
        `🔔 Exiting silent mode: ${reason}${durationStr}`,
        undefined,
        LogLevel.INFO,
      );
    }
  }

  // --- Shutdown Logic ---

  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      await this.logger.log(
        `\n🚦 Received ${signal}. Shutting down gracefully...`,
        undefined,
        LogLevel.INFO,
      );
      this.exitSilentMode(`${signal} received`);

      // Close browser if open
      await this.portalAuthenticator.closeBrowser();

      // Optional: Disconnect from WiFi on exit?
      // await this.wifiManager.disconnectFromWifi();

      await this.logger.log(
        "👋 Application shut down.",
        undefined,
        LogLevel.INFO,
      );
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT")); // Ctrl+C
    process.on("SIGTERM", () => shutdown("SIGTERM")); // Termination signal
    process.on("uncaughtException", async (error) => {
      await this.logger.log("💥 Uncaught Exception:", error, LogLevel.ERROR);
      await shutdown("uncaughtException");
    });
    process.on("unhandledRejection", async (reason, promise) => {
      await this.logger.log(
        "🚫 Unhandled Rejection at:",
        promise,
        LogLevel.ERROR,
      );
      await this.logger.log("🚫 Reason:", reason, LogLevel.ERROR);
      // Decide if you want to shut down on unhandled rejections
      // await shutdown('unhandledRejection');
    });
  }
}
