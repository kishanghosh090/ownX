import http from "http";
import express from "express";
import Docker from "dockerode";
import httpProxy from "http-proxy";

// docker rode setup
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const map = new Map();

docker.getEvents(function (err, stream) {
  if (err) {
    console.log("Error: ", err);
    return;
  }

  // Buffer for NDJSON stream (newline-delimited JSON)
  let buffer = "";

  stream?.on("data", (chunk) => {
    if (!chunk) {
      return;
    }
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep any incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        console.error("Failed to parse event line:", line);
        continue;
      }

      if (event.Type == "container" && event.Action == "start" && event.id) {
        (async () => {
          try {
            const container = docker.getContainer(event.id);
            const containerInfo = await container.inspect();

            const containerName = containerInfo.Name.substring(1);

            // Networks is an object keyed by network name, e.g. { "bridge": { IPAddress: "..." } }
            const networks = containerInfo.NetworkSettings.Networks;
            const firstNetwork = Object.values(networks)[0];
            const ipAddress = firstNetwork?.IPAddress;

            const exposedPORTS = Object.keys(
              containerInfo.Config.ExposedPorts ?? {},
            );
            let defaultPort = null;

            if (exposedPORTS.length > 0) {
              const [port, type] = exposedPORTS[0]?.split("/") ?? [
                undefined,
                undefined,
              ];
              if (type == "tcp") {
                defaultPort = port;
              }
            }

            console.log(
              `Container Registered ${containerName}. Proxy set ${containerName}.localhost -> http://${ipAddress}${defaultPort != null ? ":" : ""}${defaultPort ?? ""}`,
            );

            map.set(containerName, { ipAddress, defaultPort });
          } catch (err) {
            console.error("Error inspecting container:", err);
          }
        })();
      }
    }
  });

  stream?.on("error", (err) => {
    console.error("Docker event stream error:", err);
  });

  stream?.on("end", () => {
    console.log("Docker event stream ended");
  });
});

// Populate map with already-running containers on startup
async function initializeRunningContainers() {
  try {
    const containers = await docker.listContainers();
    for (const containerInfo of containers) {
      const container = docker.getContainer(containerInfo.Id);
      const info = await container.inspect();

      const containerName = info.Name.substring(1);
      const networks = info.NetworkSettings.Networks;
      const firstNetwork = Object.values(networks)[0];
      const ipAddress = firstNetwork?.IPAddress;

      const exposedPORTS = Object.keys(info.Config.ExposedPorts ?? {});
      let defaultPort = null;

      if (exposedPORTS.length > 0) {
        const [port, type] = exposedPORTS[0]?.split("/") ?? [
          undefined,
          undefined,
        ];
        if (type == "tcp") {
          defaultPort = port;
        }
      }

      console.log(
        `Container Registered (existing) ${containerName}. Proxy set ${containerName}.localhost -> http://${ipAddress}${defaultPort != null ? ":" : ""}${defaultPort ?? ""}`,
      );

      map.set(containerName, { ipAddress, defaultPort });
    }
  } catch (err) {
    console.error("Error initializing running containers:", err);
  }
}

initializeRunningContainers();

const reverseProxyApp = express();
const reverseProxy = http.createServer(reverseProxyApp);
const proxy = httpProxy.createProxyServer();

reverseProxyApp.use((req, res) => {
  const hostName = req.hostname;

  const subDomain = hostName.split(".")[0];

  if (!map.has(subDomain)) {
    return res.status(404).end("Not Found");
  }
  const { ipAddress, defaultPort } = map.get(subDomain);

  if (!ipAddress) {
    return res.status(502).end("Bad Gateway: no IP address");
  }

  const target = defaultPort
    ? `http://${ipAddress}:${defaultPort}`
    : `http://${ipAddress}`;

  console.log(`forwarding ${hostName} -> ${target}`);

  let responseSent = false;
  const sendResponse = (status: number, body: string) => {
    if (responseSent) return;
    responseSent = true;
    res.status(status).end(body);
  };

  // Hard timeout: if no response within 5 seconds, force close the connection
  const timeoutId = setTimeout(() => {
    req.socket?.destroy();
    sendResponse(502, "Bad Gateway: upstream timeout");
  }, 5000);

  res.on("close", () => clearTimeout(timeoutId));

  try {
    return proxy.web(req, res, { target, changeOrigin: true });
  } catch (err: any) {
    clearTimeout(timeoutId);
    sendResponse(502, `Bad Gateway: ${err.message}`);
  }
});

// Handle proxy errors so the response doesn't hang
proxy.on("error", (err, req, res: any) => {
  console.error("Proxy error:", err.message);
  if (res && !res.headersSent) {
    res.status(502).end("Bad Gateway");
  }
});

const app = express();
const PORT = process.env.PORT ?? 8080;

app.use(express.json());

app.post("/container", async (req, res) => {
  try {
    const { image, tag = "latest" } = req.body;
    const Image = `${image}:${tag}`;

    const images = await docker.listImages();
    let isImageAlreadyExists = false;

    for (const sysImagesWithTag of images) {
      if (
        typeof sysImagesWithTag == "object" &&
        sysImagesWithTag.RepoTags != undefined
      ) {
        for (const sysImage of sysImagesWithTag.RepoTags) {
          if (sysImage == Image) {
            isImageAlreadyExists = true;
            break;
          }
        }
        if (isImageAlreadyExists) break;
      }
    }

    if (!isImageAlreadyExists) {
      console.log(`Pulling Image: ${Image} ...`);
      await docker.pull(Image);
    }

    const container = await docker.createContainer({
      Image: Image,
      Tty: false,
      HostConfig: {
        AutoRemove: true,
      },
    });

    // Inspect before starting — once started, AutoRemove may delete it instantly
    const containerInfo = await container.inspect();
    const containerName = containerInfo.Name.substring(1);

    await container.start();

    return res.status(201).json({
      status: "success",
      container: `${containerName}.localhost`,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({ message: error ?? "internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is listing at PORT ${PORT}`);
});
reverseProxy.listen(80, () => {
  console.log(`reverse proxy is listing at PORT 80`);
});
