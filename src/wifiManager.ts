import wifi from "node-wifi";
import { Logger } from "./logger";
import { LogLevel } from "./types";
import * as os from "os";
import { WifiInitializer } from "./WifiInitializer";
import { NetworkInterfaceManager } from "./NetworkInterfaceManager";
import { AccessPointScanner } from "./AccessPointScanner";
import { WifiConnector } from "./WifiConnector";
// import { exec } from 'child_process'; // Keep commented if not used
// import { promisify } from 'util'; // Keep commented if not used
// const execAsync = promisify(exec);

// --- Service Class: WifiConnector ---

// --- Service Class: NetworkInterfaceManager ---

// --- Service Class: AccessPointScanner (Placeholder) ---

// --- Facade Class: WifiManager ---
export class WifiManager {
  private logger: Logger;
  private initializer: WifiInitializer;
  private connector: WifiConnector;
  private networkInterfaceManager: NetworkInterfaceManager;
  private accessPointScanner: AccessPointScanner;

  constructor(logger: Logger) {
    this.logger = logger;
    this.initializer = new WifiInitializer(logger);
    this.connector = new WifiConnector(logger, this.initializer);
    this.networkInterfaceManager = new NetworkInterfaceManager(logger);
    this.accessPointScanner = new AccessPointScanner(logger);
  }

  /**
   * Initializes the node-wifi library via the initializer service.
   */
  public init(): void {
    // Attempt initialization, log if already done or failed (handled in initializer)
    this.initializer.init();
  }

  /**
   * Attempts to connect to the specified Wi-Fi network via the connector service.
   */
  public async connectToWifi(ssid: string, password?: string): Promise<void> {
    // Ensure initialization before attempting connection
    if (!this.initializer.isInitialized) {
      this.logger.log(
        "Attempting to initialize node-wifi before connecting...",
        undefined,
        LogLevel.DEBUG,
      );
      if (!this.initializer.init()) {
        this.logger.log(
          "Initialization failed, cannot connect.",
          undefined,
          LogLevel.ERROR,
        );
        return; // Exit if initialization failed
      }
    }
    await this.connector.connect(ssid, password);
  }

  /**
   * Attempts to disconnect from the current Wi-Fi network via the connector service.
   */
  public async disconnectFromWifi(): Promise<void> {
    await this.connector.disconnect();
  }

  /**
   * Retrieves the device's MAC address via the network interface manager service.
   */
  public getDeviceMacAddress(): string | null {
    return this.networkInterfaceManager.getDeviceMacAddress();
  }

  /**
   * Retrieves the access point's MAC address via the access point scanner service.
   */
  public async getAccessPointMacAddress(
    targetSsid: string,
  ): Promise<string | null> {
    return this.accessPointScanner.getAccessPointMacAddress(targetSsid);
  }
}
