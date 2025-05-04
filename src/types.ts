/**
 * Enum representing the different log levels.
 * @enum {string}
 */
export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

/**
 * Enum representing the network connectivity status.
 * @enum {string}
 */
export enum ConnectivityStatus {
  ONLINE = "ONLINE",
  OFFLINE = "OFFLINE",
  CAPTIVE_PORTAL = "CAPTIVE_PORTAL",
}

/**
 * Interface defining the structure for the application configuration.
 * @interface AppConfig
 */
export interface AppConfig {
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
 * Interface for form data used in portal authentication.
 */
export interface PortalFormData {
  idnumber: string;
  name: string;
  surname: string;
  birthyear: string;
}
