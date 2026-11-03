# Eclipse Orbit Web

A browser-based member of the Eclipse Orbit ecosystem. The web client has two connection modes:

1. **Standalone local AI** — connects directly from the browser to a user's local Ollama server. Eclipse Orbit desktop does not need to be open.
2. **Eclipse Orbit Companion** — uses the same Edge Native Messaging host and request protocol as the Companion side panel. It shares desktop conversations, available models, and Persistent Memory. Eclipse Orbit desktop must be running in this mode.

There is no hosted inference backend, account system, subscription, or prompt relay in this repository.

## Production website

Eclipse Orbit Web is published at:

**https://orbit.austinmcdonald.dev**

The static site is hosted by GitHub Pages. Cloudflare manages the custom-domain DNS record. The Companion extension recognizes this exact HTTPS origin.

## Standalone Ollama mode

1. Install and start Ollama on the same computer as the browser.
2. Install at least one local model.
3. Open Eclipse Orbit Web and choose **Standalone local AI**.
4. Keep the endpoint at `http://127.0.0.1:11434`, unless Ollama is configured on another local address.
5. Test the connection and select a model.

When the website is hosted over HTTPS, the browser treats requests to a local service as local-network access. It may ask permission before allowing the connection. Ollama must also allow the website's origin through CORS.

To add the production website to Ollama's allowed browser origins without discarding other origins already configured for your Windows user account, run this in PowerShell:

```powershell
$origin = "https://orbit.austinmcdonald.dev"
$current = [Environment]::GetEnvironmentVariable("OLLAMA_ORIGINS", "User")
$origins = @($current -split "," | Where-Object { $_ -and $_ -ne $origin })
$origins += $origin
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", ($origins -join ","), "User")
```

Restart Ollama after changing the variable. Do not use a wildcard origin for a public deployment. If you also use the GitHub Pages preview URL or a localhost development server, add those exact origins as needed.

Ollama's official CORS guidance: https://github.com/ollama/ollama/blob/main/docs/faq.mdx

## Companion mode

Companion mode requires:

- Eclipse Orbit desktop installed and running.
- The Eclipse Orbit Companion Edge extension installed and enabled.
- The native messaging host registered by the desktop application.

The extension exposes a narrowly scoped page bridge only on the Eclipse Orbit Web origin. The website itself cannot call Edge's `connectNative` API. Instead, the extension forwards website requests through the existing native host, which uses the same `EclipseOrbitBrowserBridge` local socket and the same request types as the side panel.

Supported shared operations include chat state, chat history, model selection, chat generation, and persistent memory. This mode is the synchronized experience; standalone Ollama mode intentionally keeps its own browser-local conversation history.

## Privacy and data

- Standalone prompts are sent directly from the browser to the configured local Ollama endpoint.
- Companion requests are sent through the installed extension to the local Orbit desktop app.
- Standalone web conversation history is stored in this browser's local storage.
- Shared memory is available only in Companion mode and remains in Orbit's local persistent-memory store.
- This project does not contain analytics, a cloud API, or a hosted model proxy.

## Development

This is a static site. Serve the repository over localhost for development, or publish it with GitHub Pages. The Companion extension's web bridge also allows localhost origins for development.

## Important distinction

The website can run local inference without the Orbit desktop app when Ollama is running. Features that are owned by the desktop application—its shared chat store, coding agent, and persistent memory—require Companion mode and the desktop app.
