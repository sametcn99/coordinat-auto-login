import wifi from "node-wifi";
import { Logger } from "./logger";
import { LogLevel } from "./types";
import * as os from "os";
// import { exec } from 'child_process'; // Keep commented if not used
// import { promisify } from 'util'; // Keep commented if not used
// const execAsync = promisify(exec);

export class WifiManager {
  private logger: Logger;
  private initialized: boolean = false;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Initializes the node-wifi library.
   * Should be called once before using other methods.
   */
  public init(): void {
    if (this.initialized) {
      this.logger.log(
        "node-wifi already initialized.",
        undefined,
        LogLevel.DEBUG,
      );
      return;
    }
    try {
      wifi.init({
        iface: null, // network interface, choose a random wifi interface if set to null
      });
      this.initialized = true;
      this.logger.log("📶 node-wifi initialized.", undefined, LogLevel.DEBUG);
    } catch (error) {
      this.logger.log(
        "❌ Failed to initialize node-wifi",
        error,
        LogLevel.ERROR,
      );
      this.initialized = false; // Ensure it's marked as not initialized
    }
  }

  /**
   * Attempts to connect to the specified Wi-Fi network using `node-wifi`.
   * @param ssid The SSID of the network.
   * @param password The password of the network (optional).
   * @returns {Promise<void>} A promise that resolves when the connect command is initiated.
   */
  public async connectToWifi(ssid: string, password?: string): Promise<void> {
    if (!this.initialized) {
      this.logger.log(
        "⚠️ node-wifi not initialized. Call init() first.",
        undefined,
        LogLevel.WARN,
      );
      this.init(); // Attempt to initialize now
      if (!this.initialized) return; // Exit if initialization failed
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
    } catch (error) {
      await this.logger.log(
        `❌ Error connecting to WiFi using node-wifi`,
        error,
        LogLevel.ERROR,
      );
    }
  }

  /**
   * Attempts to disconnect from the current Wi-Fi network using `node-wifi`.
   * @returns {Promise<void>} A promise that resolves when the disconnect command is executed.
   */
  public async disconnectFromWifi(): Promise<void> {
    if (!this.initialized) {
      this.logger.log(
        "⚠️ node-wifi not initialized. Cannot disconnect.",
        undefined,
        LogLevel.WARN,
      );
      return;
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
    } catch (error) {
      await this.logger.log(
        "❌ Error disconnecting from WiFi using node-wifi",
        error,
        LogLevel.ERROR,
      );
    }
  }

  /**
   * Retrieves the MAC address of the first active non-internal IPv4 network interface.
   * @returns {string | null} The MAC address string, or null if none is found.
   */
  public getDeviceMacAddress(): string | null {
    try {
      const interfaces = os.networkInterfaces();
      for (const name of Object.keys(interfaces)) {
        const ifaceDetails = interfaces[name];
        if (!ifaceDetails) continue; // Skip if undefined

        for (const iface of ifaceDetails) {
          // Skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
          // Skip loopback, non-IPv4, and potentially virtual adapters
          if (
            iface.internal ||
            iface.family !== "IPv4" ||
            iface.mac === "00:00:00:00:00:00"
          ) {
            continue;
          }
          // Return the first valid MAC address found
          this.logger.log(
            `🔍 Found active interface: ${name}, MAC: ${iface.mac}`,
            undefined,
            LogLevel.DEBUG,
          );
          return iface.mac;
        }
      }
      this.logger.log(
        "❓ No suitable active network interface found to get MAC address.",
        undefined,
        LogLevel.WARN,
      );
      return null;
    } catch (error) {
      this.logger.log(
        "❌ Error getting device MAC address",
        error,
        LogLevel.ERROR,
      );
      return null;
    }
  }

  /**
   * Placeholder function to get the MAC address of the target Wi-Fi network's access point.
   * Note: This is highly OS-dependent and likely requires platform-specific implementations
   * or external libraries/commands. Currently returns null.
   * @async
   * @returns {Promise<string | null>} A promise that resolves with the AP's MAC address or null.
   */
  public async getAccessPointMacAddress(
    targetSsid: string,
  ): Promise<string | null> {
    await this.logger.log(
      `🔍 Scanning for WiFi AP MAC address for SSID: ${targetSsid} (placeholder)...`,
      undefined,
      LogLevel.DEBUG,
    );
    // This requires platform-specific commands or libraries.
    // Example placeholder logic:
    try {
      // On Windows: netsh wlan show interfaces
      // On macOS: /System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I
      // On Linux: iw dev <interface> link or nmcli dev wifi list
      // You would need to execute these commands and parse the output.

      // --- Placeholder ---
      // const { stdout } = await execAsync('your-platform-specific-command');
      // const parsedMac = parseOutputForMac(stdout, targetSsid);
      // if (parsedMac) {
      //    await this.logger.log(`✅ Found AP MAC: ${parsedMac}`, undefined, LogLevel.DEBUG);
      //    return parsedMac;
      // }
      // --- End Placeholder ---

      await this.logger.log(
        "⚠️ WiFi AP MAC address scanning not implemented for this OS.",
        undefined,
        LogLevel.WARN,
      );
      return null;
    } catch (error) {
      await this.logger.log(
        "❌ Error scanning WiFi networks for AP MAC",
        error,
        LogLevel.ERROR,
      );
      return null;
    }
  }
}
