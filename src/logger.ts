import * as fs from "fs/promises";
import * as path from "path";
import type { Ora } from "ora"; // Assuming ora is used for silent mode spinner
import { LogLevel } from "./types";

export class Logger {
  private LOG_FILE: string;
  private silentMode: boolean = false;
  private silentModeSpinner: Ora | null = null;
  private silentModeStartTime: number | null = null;
  private readonly MAX_LOG_SIZE_MB = 10; // Max log file size in MB

  constructor(logDirectory: string = __dirname) {
    this.LOG_FILE = path.join(logDirectory, "coordinat-auto-login.log");
  }

  public setSilentMode(silent: boolean, spinner?: Ora | null): void {
    this.silentMode = silent;
    this.silentModeSpinner = spinner || null;
    if (silent && !this.silentModeStartTime) {
      this.silentModeStartTime = Date.now();
    } else if (!silent) {
      this.silentModeStartTime = null;
      if (this.silentModeSpinner?.isSpinning) {
        this.silentModeSpinner.stop();
      }
    }
  }

  public isSilent(): boolean {
    return this.silentMode;
  }

  public getSilentDurationMs(): number | null {
    return this.silentMode && this.silentModeStartTime
      ? Date.now() - this.silentModeStartTime
      : null;
  }

  /**
   * Formats a duration in milliseconds into a human-readable string.
   * @private
   * @param {number} ms - The duration in milliseconds.
   * @returns {string} A formatted string (e.g., "5 seconds", "2 minutes", "1 hour 15 minutes").
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours} hour${hours > 1 ? "s" : ""}${remainingMinutes > 0 ? ` ${remainingMinutes} minute${remainingMinutes > 1 ? "s" : ""}` : ""}`;
    } else if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes} minute${minutes > 1 ? "s" : ""}${remainingSeconds > 0 ? ` ${remainingSeconds} second${remainingSeconds > 1 ? "s" : ""}` : ""}`;
    } else {
      return `${seconds} second${seconds !== 1 ? "s" : ""}`;
    }
  }

  /**
   * Updates the text of the silent mode spinner with the current duration.
   * @private
   */
  public updateSilentModeSpinner(): void {
    if (this.silentModeSpinner && this.silentModeStartTime) {
      const silentDurationMs = Date.now() - this.silentModeStartTime;
      const formattedDuration = this.formatDuration(silentDurationMs);
      this.silentModeSpinner.text = `Connection active. Silent for: ${formattedDuration}`;
    }
  }

  public async log(
    message: string,
    error?: Error | string | unknown,
    level: LogLevel = LogLevel.INFO,
  ): Promise<void> {
    // If there's an error, handle potential silent mode exit FIRST
    if (error && this.silentMode) {
      if (this.silentModeSpinner?.isSpinning) {
        this.silentModeSpinner.fail("Silent mode interrupted by error.");
      }
      this.setSilentMode(false); // Exit silent mode on error
      // Log the original message that might have been suppressed before the error
      await this.log(message, undefined, level);
      // Now log the error itself
      message = "Error occurred"; // Reset message for the error log entry
    }
    // If in silent mode (and no error caused an exit above), suppress most logging.
    else if (this.silentMode) {
      // Check if the message is the sleep message, if so, update spinner briefly
      if (message.startsWith("💤 Sleeping for")) {
        if (this.silentModeSpinner) {
          const originalText = this.silentModeSpinner.text;
          this.silentModeSpinner.text = message; // Show sleep message briefly
          await new Promise((resolve) => setTimeout(resolve, 1000)); // Show for 1 sec
          this.updateSilentModeSpinner(); // Restore silent duration text
        }
      }
      return; // Suppress other logs in silent mode
    }

    // --- Normal logging logic ---
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

    // Log to console based on level
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(logMessage); // Use console.debug for DEBUG
        break;
      case LogLevel.INFO:
        console.info(logMessage); // Use console.info for INFO
        break;
      case LogLevel.WARN:
        console.warn(logMessage); // Use console.warn for WARN
        break;
      case LogLevel.ERROR:
        console.error(logMessage); // Use console.error for ERROR
        break;
      default:
        console.log(logMessage); // Default to console.log
    }

    // Append to log file
    try {
      // Check file size and rotate if necessary
      try {
        const stats = await fs.stat(this.LOG_FILE);
        const maxSize = this.MAX_LOG_SIZE_MB * 1024 * 1024;
        if (stats.size > maxSize) {
          await fs.rename(this.LOG_FILE, `${this.LOG_FILE}.old`);
          console.log(`[${new Date().toISOString()}][INFO] Log file rotated.`);
          logMessage =
            `[${timestamp}][INFO][${memoryInfo}] Log file rotated due to size limit.\n` +
            logMessage; // Add rotation notice
        }
      } catch (statError: any) {
        if (statError.code !== "ENOENT") {
          console.error(
            `[${new Date().toISOString()}][ERROR] Error checking log file stats: ${statError.message}`,
          );
        }
        // If file doesn't exist, it will be created by appendFile
      }

      // Append the new log message
      await fs.appendFile(this.LOG_FILE, logMessage + "\n");
    } catch (err: any) {
      console.error(
        `[${new Date().toISOString()}][ERROR] Failed to write to log file: ${err.message}`,
      );
    }
  }
}
