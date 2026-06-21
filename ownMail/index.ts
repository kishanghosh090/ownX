import http from "node:http";
import SMTPServer from "smtp-server";
import { sendMail, type SendMailOptions } from "./sendmail.ts";

// reciving mail
const smtpServer = new SMTPServer.SMTPServer({
  allowInsecureAuth: true,
  authOptional: true,
  hideSTARTTLS: true,
  disabledCommands: ["AUTH"],
  onConnect(session, callback) {
    console.log("Client connected:", session.remoteAddress);
    console.log("Session id:", session.id);

    callback(); // Accept the connection [if we want to rejct the connection ... new Error("some error") -> reject the connectinon]
  },
  onAuth(auth, session, callback) {
    callback(undefined);
  },
  onMailFrom(address, session, callback) {
    console.log("mail from ", address.address);
    console.log("session id ", session.id);

    // accepted
    callback();
  },
  onRcptTo(address, session, callback) {
    console.log("mail send to ", address.address);
    // check in db if user is exist or not in our mail service db
    console.log("session id ", session.id);
    callback();
  },
  onData(stream, session, callback) {
    let data = "";
    stream.on("data", (chunk) => {
      // save data to our db
      data += chunk.toString();
      console.log("Data recived", chunk);
    });
    stream.on("end", () => {
      console.log("stream end...");
      console.log("Full email data:", data);
      callback();
    });
    stream.on("error", (err) => {
      console.log("Error :", err.message);
      callback(new Error("Failed to recive data"));
    });
  },
});

smtpServer.listen(25, () => {
  console.log("SMTP server is listening on port 25");
});

// --- REST API for sending mail ---
const HTTP_PORT = parseInt(process.env["HTTP_PORT"] || "3000", 10);

const httpServer = http.createServer(async (req, res) => {
  // CORS headers for browser-based clients
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Only accept POST /send
  if (req.method !== "POST" || req.url !== "/send") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use POST /send" }));
    return;
  }

  // Read request body
  let body = "";
  req.on("data", (chunk) => {
    body += chunk.toString();
  });

  req.on("end", async () => {
    try {
      const data = JSON.parse(body);

      // Validate required fields
      if (!data.from || !data.to || !data.subject) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Missing required fields: from, to, subject",
          })
        );
        return;
      }

      const to: string[] = Array.isArray(data.to) ? data.to : [data.to];

      const mailOptions: SendMailOptions = {
        from: data.from,
        to,
        subject: data.subject,
        text: data.text || "",
      };

      console.log(`[REST] Sending email from ${data.from} to ${to.join(", ")}`);

      await sendMail(mailOptions);

      console.log(`[REST] Email sent successfully to ${to.join(", ")}`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, message: "Email sent successfully" }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[REST] Failed to send email: ${message}`);

      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  });

  req.on("error", (err) => {
    console.error(`[REST] Request error: ${err.message}`);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Internal server error" }));
  });
});

httpServer.listen(HTTP_PORT, () => {
  console.log(`REST API server is listening on port ${HTTP_PORT}`);
  console.log(`  POST http://localhost:${HTTP_PORT}/send`);
  console.log(`  Body: { "from": "...", "to": "...", "subject": "...", "text": "..." }`);
});
