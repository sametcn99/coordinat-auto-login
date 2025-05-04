import axios from "axios";
import { Logger } from "./logger";
import { ConnectivityStatus, LogLevel } from "./types";

export class ConnectivityChecker {
  private logger: Logger;
  private readonly checkUrl =
    "http://connectivitycheck.gstatic.com/generate_204";
  private readonly backupCheckUrl =
    "http://www.msftconnecttest.com/connecttest.txt";
  private readonly timeout = 5000; // 5 seconds

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Checks the current internet connectivity status.
   * It attempts to reach standard connectivity check URLs (Google, Microsoft).
   * Determines if the status is ONLINE, OFFLINE, or behind a CAPTIVE_PORTAL.
   * @async
   * @returns {Promise<ConnectivityStatus>} A promise resolving to the determined connectivity status.
   */
  public async checkConnectivityStatus(): Promise<ConnectivityStatus> {
    await this.logger.log(
      `🌐 Checking connectivity status via ${this.checkUrl}...`,
      undefined,
      LogLevel.DEBUG,
    );

    try {
      // First try Google's connectivity check - status 204 means we're online
      const response = await axios.get(this.checkUrl, {
        timeout: this.timeout,
        maxRedirects: 0, // Don't follow redirects automatically
        validateStatus: function (status) {
          return true; // Accept any status code initially
        },
      });

      // Status 204 with empty content from Google means we're online
      if (response.status === 204) {
        await this.logger.log(
          `✅ Connectivity check passed (Google ${response.status}): Direct internet access confirmed.`,
          undefined,
          LogLevel.DEBUG,
        );
        return ConnectivityStatus.ONLINE;
      }
      // If we get a redirect or a different status, it's likely a captive portal
      else if (response.status >= 200 && response.status < 400) {
        // Check if the response body indicates a captive portal (optional, depends on portal)
        // if (response.data && response.data.toLowerCase().includes('login')) { ... }
        await this.logger.log(
          `⚠️ Connectivity check indicates Captive Portal (Google Status ${response.status})`,
          undefined,
          LogLevel.WARN,
        );
        return ConnectivityStatus.CAPTIVE_PORTAL;
      }
      // Any other status (e.g., 5xx) probably means we're offline or there's an issue
      else {
        await this.logger.log(
          `❓ Unexpected status code ${response.status} from Google. Assuming Offline or Portal.`,
          undefined,
          LogLevel.WARN,
        );
        // Consider trying backup before declaring OFFLINE
        return await this.tryBackupCheck();
      }
    } catch (err) {
      // Handle specific errors from the primary check
      if (axios.isAxiosError(err)) {
        if (err.code === "ECONNABORTED") {
          await this.logger.log(
            `❌ Connectivity check failed: Timeout accessing ${this.checkUrl}`,
            undefined,
            LogLevel.WARN,
          );
        } else if (err.response) {
          // This case might be redundant due to validateStatus: true, but kept for safety
          await this.logger.log(
            `❌ Connectivity check failed: Received status ${err.response.status} from ${this.checkUrl}`,
            undefined,
            LogLevel.WARN,
          );
        } else if (err.request) {
          // Network error (e.g., DNS resolution failure, no route to host)
          await this.logger.log(
            `❌ Connectivity check failed: No response received from ${this.checkUrl} (Network Error)`,
            err.message, // Include the specific network error message
            LogLevel.WARN,
          );
        } else {
          // Error setting up the request
          await this.logger.log(
            `❌ Connectivity check failed: Error setting up request to ${this.checkUrl}`,
            err.message,
            LogLevel.ERROR,
          );
        }
      } else {
        // Non-Axios error
        await this.logger.log(
          `❌ Connectivity check failed: Unknown error accessing ${this.checkUrl}`,
          err,
          LogLevel.ERROR,
        );
      }

      // If primary check failed, try the backup
      return await this.tryBackupCheck();
    }
  }

  /**
   * Tries the backup connectivity check URL (Microsoft).
   * @private
   * @async
   * @returns {Promise<ConnectivityStatus>} Status based on the backup check.
   */
  private async tryBackupCheck(): Promise<ConnectivityStatus> {
    try {
      await this.logger.log(
        `🔄 Trying backup connectivity check via ${this.backupCheckUrl}...`,
        undefined,
        LogLevel.DEBUG,
      );
      const backupResponse = await axios.get(this.backupCheckUrl, {
        timeout: this.timeout,
        validateStatus: () => true, // Accept any status
      });

      // If we can access Microsoft's URL and get the expected content, we're online
      if (
        backupResponse.status >= 200 &&
        backupResponse.status < 300 && // Check for 2xx status
        backupResponse.data &&
        typeof backupResponse.data === "string" && // Ensure data is a string
        backupResponse.data.includes("Microsoft Connect Test")
      ) {
        await this.logger.log(
          `✅ Backup connectivity check passed (MS ${backupResponse.status}): Internet access confirmed.`,
          undefined,
          LogLevel.DEBUG,
        );
        return ConnectivityStatus.ONLINE;
      } else {
        // If backup check doesn't confirm online status, assume portal or offline
        await this.logger.log(
          `⚠️ Backup check did not confirm online status (MS Status ${backupResponse.status}). Assuming Captive Portal or Offline.`,
          undefined,
          LogLevel.WARN,
        );
        // We can't definitively distinguish between portal and offline here without more checks
        // Defaulting to CAPTIVE_PORTAL as it often requires action.
        return ConnectivityStatus.CAPTIVE_PORTAL;
      }
    } catch (backupErr) {
      await this.logger.log(
        `❌ Backup connectivity check failed. Assuming Offline.`,
        backupErr, // Log the backup error details
        LogLevel.WARN,
      );
      return ConnectivityStatus.OFFLINE;
    }
  }
}
