import net from "node:net";
import dns from "node:dns/promises";

export interface SendMailOptions {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
}

/**
 * Resolve MX records for a domain, sorted by priority (lowest first).
 */
async function resolveMX(domain: string): Promise<string> {
  const records = await dns.resolveMx(domain);
  // Sort by priority (lower = higher priority)
  records.sort((a, b) => a.priority - b.priority);
  if (records.length === 0) {
    throw new Error(`No MX records found for domain: ${domain}`);
  }
  return records[0]!.exchange;
}

/**
 * Read a single SMTP response line (or multi-line response) from the socket.
 * Returns the full response string.
 */
function readResponse(socket: net.Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk: Buffer) => {
      data += chunk.toString();
      // SMTP responses end with "\r\n"
      // Multi-line responses have "nnn-" for intermediate lines, "nnn " for the last line
      const lines = data.split("\r\n");
      // Remove the trailing empty string from split
      const nonEmpty = lines.filter((l) => l.length > 0);
      if (nonEmpty.length > 0) {
        const lastLine = nonEmpty[nonEmpty.length - 1]!;
        // Check if the last line starts with a 3-digit code followed by a space (end of response)
        if (/^\d{3} /.test(lastLine)) {
          cleanup();
          resolve(data.trim());
        }
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Connection closed unexpectedly"));
    };
    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

/**
 * Send a command and wait for the response.
 */
async function sendCommand(
  socket: net.Socket,
  command: string
): Promise<string> {
  socket.write(command + "\r\n");
  return readResponse(socket);
}

/**
 * Build a raw email message (RFC 2822).
 */
function buildEmail(options: SendMailOptions): string {
  const headers: string[] = [
    `From: ${options.from}`,
    `To: ${options.to.join(", ")}`,
    `Subject: ${options.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 7bit",
    `Date: ${new Date().toUTCString()}`,
    "X-Mailer: ownMail-SMTP-Client",
  ];

  const body = options.text || "";

  return headers.join("\r\n") + "\r\n\r\n" + body;
}

/**
 * Send an email using raw SMTP (no third-party packages).
 * Resolves the MX record for the recipient's domain, connects via TCP,
 * and performs the SMTP handshake.
 */
export async function sendMail(options: SendMailOptions): Promise<void> {
  // Extract domain from the first recipient
  const firstTo = options.to[0];
  if (!firstTo) {
    throw new Error("No recipients specified");
  }
  const domain = firstTo.split("@")[1];
  if (!domain) {
    throw new Error(`Invalid recipient address: ${firstTo}`);
  }

  // 1. Resolve MX record
  const mxHost = await resolveMX(domain);
  console.log(`[SMTP] Resolved MX for ${domain}: ${mxHost}`);

  // 2. Connect to the mail server on port 25
  const socket = new net.Socket();
  socket.setTimeout(30000); // 30 second timeout

  await new Promise<void>((resolve, reject) => {
    socket.connect(25, mxHost, () => {
      resolve();
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Connection timed out"));
    });
  });

  try {
    // 3. Read the server greeting (220)
    const greeting = await readResponse(socket);
    console.log(`[SMTP] << ${greeting}`);

    // 4. Send HELO
    const heloResponse = await sendCommand(socket, `HELO ownmail.local`);
    console.log(`[SMTP] << ${heloResponse}`);

    // 5. Send MAIL FROM
    const mailFromResponse = await sendCommand(
      socket,
      `MAIL FROM:<${options.from}>`
    );
    console.log(`[SMTP] << ${mailFromResponse}`);

    // 6. Send RCPT TO for each recipient
    for (const recipient of options.to) {
      const rcptToResponse = await sendCommand(
        socket,
        `RCPT TO:<${recipient}>`
      );
      console.log(`[SMTP] << ${rcptToResponse}`);
    }

    // 7. Send DATA
    const dataResponse = await sendCommand(socket, "DATA");
    console.log(`[SMTP] << ${dataResponse}`);

    // 8. Send the email content
    const emailContent = buildEmail(options);
    socket.write(emailContent + "\r\n.\r\n");
    const endResponse = await readResponse(socket);
    console.log(`[SMTP] << ${endResponse}`);

    // 9. Send QUIT
    const quitResponse = await sendCommand(socket, "QUIT");
    console.log(`[SMTP] << ${quitResponse}`);

    console.log("[SMTP] Email sent successfully!");
  } finally {
    socket.destroy();
  }
}