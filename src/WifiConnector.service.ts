import wifi from "node-wifi";
import { Logger } from "./logger";
import { LogLevel } from "./types";
import type { WifiInitializer } from "./WifiInitializer.service";

export class WifiConnector {
  private logger: Logger;
  private initializer: WifiInitializer;

  constructor(logger: Logger, initializer: WifiInitializer) {
    this.logger = logger;
    this.initializer = initializer;
  }

  /**
   * Attempts to connect to the specified Wi-Fi network using `node-wifi`.
   */
  public async connect(ssid: string, password?: string): Promise<boolean> {
    if (!this.initializer.isInitialized) {
      this.logger.log(
        "⚠️ node-wifi not initialized. Cannot connect.",
        undefined,
        LogLevel.WARN,
      );
      return false;
    }
    await this.logger.log(
      `📶 Attempting to connect to WiFi: ${ssid} using node-wifi...`,
      undefined,
      LogLevel.INFO,
    );
    try {
      await wifi.connect({ ssid, password: password || "" }); // Use empty string if password is undefined
      await this.logger.log(
        `✅ WiFi connect command initiated for ${ssid}. Check status shortly.`,
        undefined,
        LogLevel.INFO,
      );
      return true;
    } catch (error) {
      await this.logger.log(
        `❌ Error connecting to WiFi using node-wifi`,
        error,
        LogLevel.ERROR,
      );
      return false;
    }
  }

  /**
   * Attempts to disconnect from the current Wi-Fi network using `node-wifi`.
   */
  public async disconnect(): Promise<boolean> {
    if (!this.initializer.isInitialized) {
      this.logger.log(
        "⚠️ node-wifi not initialized. Cannot disconnect.",
        undefined,
        LogLevel.WARN,
      );
      return false;
    }
    await this.logger.log(
      "🔌 Attempting to disconnect from WiFi using node-wifi...",
      undefined,
      LogLevel.INFO,
    );
    try {
      await wifi.disconnect();
      await this.logger.log(
        "✅ WiFi disconnect command executed via node-wifi.",
        undefined,
        LogLevel.INFO,
      );
      return true;
    } catch (error) {
      await this.logger.log(
        "❌ Error disconnecting from WiFi using node-wifi",
        error,
        LogLevel.ERROR,
      );
      return false;
    }
  }
}