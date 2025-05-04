import wifi from "node-wifi";
import { Logger } from "./logger";
import { LogLevel } from "./types";

// --- Service Class: WifiInitializer ---
export class WifiInitializer {
  private logger: Logger;
  private _isInitialized: boolean = false;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  public init(): boolean {
    if (this._isInitialized) {
      this.logger.log(
        "node-wifi already initialized.",
        undefined,
        LogLevel.DEBUG,
      );
      return true;
    }
    try {
      wifi.init({
        iface: null, // network interface, choose a random wifi interface if set to null
      });
      this._isInitialized = true;
      this.logger.log("📶 node-wifi initialized.", undefined, LogLevel.DEBUG);
      return true;
    } catch (error) {
      this.logger.log(
        "❌ Failed to initialize node-wifi",
        error,
        LogLevel.ERROR,
      );
      this._isInitialized = false; // Ensure it's marked as not initialized
      return false;
    }
  }
}
