# Coordinat Auto Login

[![Bun](https://img.shields.io/badge/runtime-Bun-brightgreen)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-blue)](https://www.typescriptlang.org/)

Automatically connects to the "COORDINAT" Wi-Fi network and handles captive portal authentication using Puppeteer.

## Features

- **Automatic Wi-Fi Connection:** Connects to the specified Wi-Fi network (`node-wifi`).
- **Captive Portal Authentication:** Uses Puppeteer to automatically fill and submit the login form on the captive portal.
- **Interactive Setup:** If no configuration file is found, it interactively prompts the user for necessary details.
- **Configuration File:** Stores settings in `auto-login.config.json` for easy management.
- **Connectivity Checks:** Periodically checks internet connectivity and re-authenticates if necessary.
- **Console Logging:** Provides detailed logs about the connection and authentication process.
- **Cross-Platform Build:** Can be compiled into a standalone executable (`.exe` for Windows).

## Prerequisites

- [Bun](https://bun.sh/docs/installation) runtime installed.

## Installation

1. Clone the repository or download the source code.
2. Navigate to the project directory in your terminal.
3. Install dependencies:

   ```bash
   bun install
   ```

## Configuration

The application requires configuration details to connect to the Wi-Fi and authenticate.

1. **First Run (Interactive Setup):**

   - When you run the application for the first time (`bun start`), it will check for an `auto-login.config.json` file.
   - If the file doesn't exist, it will prompt you to enter the required information:
     - Wi-Fi SSID (Network Name)
     - Wi-Fi Password (optional)
     - Captive Portal Authentication URL
     - ID Number (TC Kimlik No)
     - First Name
     - Last Name
     - Birth Year
     - Check Interval (milliseconds)
   - Your answers will be saved to `auto-login.config.json` in the project directory.

2. **Manual Configuration (`auto-login.config.json`):**

   - You can manually create or edit the `auto-login.config.json` file in the root of the project directory.
   - The file should contain the following structure:

   ```json
   {
     "WIFI_SSID": "COORDINAT",
     "WIFI_PASSWORD": "your_wifi_password_if_any",
     "AUTH_URL": "http://192.168.1.44:5000/Hotspot/Authentication", // Or the actual portal URL
     "LOGIN_INTERVAL_MS": 5000,
     "TC_NU": "12345678901",
     "NAME": "YourFirstName",
     "SURNAME": "YourLastName",
     "BIRTH_YEAR": "YYYY"
   }
   ```

### Configuration Parameters

| Parameter           | Description                                         | Default (if prompted)                     | Required |
| ------------------- | --------------------------------------------------- | ----------------------------------------- | -------- |
| `WIFI_SSID`         | The name (SSID) of the Wi-Fi network                | `COORDINAT`                               | Yes      |
| `WIFI_PASSWORD`     | The password for the Wi-Fi network                  | Empty string                              | No       |
| `AUTH_URL`          | The URL used for captive portal authentication      | `http://www.msftconnecttest.com/redirect` | Yes      |
| `LOGIN_INTERVAL_MS` | Interval between connectivity checks (milliseconds) | `5000` (5 seconds)                        | Yes      |
| `TC_NU`             | National ID Number (TC Kimlik No)                   | -                                         | Yes      |
| `NAME`              | First name for authentication                       | -                                         | Yes      |
| `SURNAME`           | Last name for authentication                        | -                                         | Yes      |
| `BIRTH_YEAR`        | Birth year (YYYY) for authentication                | -                                         | Yes      |

## Usage

### Running the Script

To start the auto-login process:

```bash
bun start
```

or

```bash
bun run index.ts
```

The script will run in the background, continuously checking the connection and authenticating when needed. Logs will be printed to the console.

### Building the Executable

You can compile the script into a standalone executable file (e.g., for Windows):

```bash
bun run build
```

This command will create `coordinat-auto-login.exe` (or a similar file depending on your OS) in the project directory. You can then run this executable directly without needing Bun or Node.js installed (though the underlying browser engine used by Puppeteer might still be required or downloaded on first run).

## How it Works

1. **Initialization:** Loads configuration from `auto-login.config.json` or prompts the user if the file is missing.
2. **Wi-Fi Connection:** Attempts to connect to the specified `WIFI_SSID` using `node-wifi`.
3. **Connectivity Check:** Periodically sends requests to known endpoints (like `gstatic.com` or `msftconnecttest.com`) to determine the connectivity status:
   - **Online:** Internet access is available. Waits for the next check interval.
   - **Offline:** No network connection detected. Attempts to reconnect to the Wi-Fi.
   - **Captive Portal:** Connected to Wi-Fi but internet access is blocked by a portal. Proceeds to authentication.
4. **Portal Authentication:**
   - Launches a headless (or visible, for debugging) browser instance using Puppeteer.
   - Navigates to a test URL to get redirected to the actual captive portal page.
   - Identifies the login form fields (ID, name, surname, birth year) using various selectors.
   - Fills the form with the details from the configuration.
   - Finds and clicks the submit/login button.
   - Closes the browser instance.
5. **Loop:** Repeats the connectivity check after the specified `LOGIN_INTERVAL_MS`.

## Logging

The application logs its activities to the console, including connection attempts, status checks, authentication steps, and errors. This helps in monitoring the process and troubleshooting issues.

## Key Dependencies

- [node-wifi](https://github.com/friedrith/node-wifi): For managing Wi-Fi connections.
- [Puppeteer](https://pptr.dev/): For controlling a headless Chrome/Chromium browser to interact with the captive portal.
- [axios](https://axios-http.com/): For making HTTP requests during connectivity checks.
- [inquirer](https://github.com/SBoudrias/Inquirer.js/): For interactively prompting the user for configuration details.
- [Bun](https://bun.sh): JavaScript runtime.
- [TypeScript](https://www.typescriptlang.org/): Language used for development.
