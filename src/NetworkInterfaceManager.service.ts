import { Logger } from "./logger";
import { LogLevel } from "./types";
import * as os from "os";

export class NetworkInterfaceManager {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Retrieves the MAC address of the first active non-internal IPv4 network interface.
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
}
