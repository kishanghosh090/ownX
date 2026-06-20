import express from "express";
import httpProxy from "http-proxy";

const app = express();
const PORT = 8000;
const proxy = httpProxy.createProxyServer({});

const BASE_URL =
  "https://ghoshkishanrana.s3.ap-south-1.amazonaws.com/__outputs";
app.use((req, res) => {
  const hostName = req.hostname;

  const subDomain = hostName.split(".")[0];

  /// get id from project using subdomain and pass wot resolveTo 
  const projectId = ""

  const resolveTo = `${BASE_URL}/${projectId}`;
  console.log(resolveTo);

  proxy.web(req, res, { target: resolveTo, changeOrigin: true }, (err) => {
    console.error("Proxy error:", err);
    res.status(500).send("Proxy error");
  });
});

proxy.on("proxyReq", (proxyReq, req, res) => {
  const url = req.url;
  if (url === "/") {
    proxyReq.path += "index.html";
  }
  return proxyReq;
});
app.listen(PORT, () => {
  console.log(`reverse proxy is running on port ${PORT}`);
});
